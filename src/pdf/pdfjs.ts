import * as pdfjs from 'pdfjs-dist/build/pdf.min.mjs';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import workerSource from 'pickme:pdf-worker';
import { CMAP_BASE64, CMAP_COUNT, STANDARD_FONT_BASE64, STANDARD_FONT_COUNT } from '../generated/pdfAssets.ts';

let workerUrl: string | null = null;

/** base64 解码一次就缓存住：pdf.js 可能对同一份 CMap 反复取值 */
const decodedCmaps = new Map<string, Uint8Array>();
const decodedFonts = new Map<string, Uint8Array>();

function decodeBase64(text: string): Uint8Array {
	const binary = atob(text);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
	return bytes;
}

function lookup(
	store: Map<string, Uint8Array>,
	table: Record<string, string>,
	key: string,
	kind: string,
): Uint8Array {
	const cached = store.get(key);
	if (cached) return cached;
	const text = table[key];
	if (!text) throw new Error(`没有内置的${kind}：${key}`);
	const data = decodeBase64(text);
	store.set(key, data);
	return data;
}

/**
 * CMap 与标准字体都内联在 main.js 里。
 * Obsidian 与 BRAT 安装插件时只会下载 main.js / manifest.json / styles.css，
 * 所以这些资源没有独立文件的分发通道——缺了 CMap，未嵌入字体的中文 PDF 会渲染失败。
 */
class InlineCMapReaderFactory {
	baseUrl: string;
	isCompressed: boolean;

	constructor(options: { baseUrl?: string | null; isCompressed?: boolean }) {
		this.baseUrl = options.baseUrl ?? '';
		this.isCompressed = options.isCompressed ?? true;
	}

	async fetch({ name }: { name: string }): Promise<{ cMapData: Uint8Array; isCompressed: boolean }> {
		return { cMapData: lookup(decodedCmaps, CMAP_BASE64, String(name), ' CMap'), isCompressed: true };
	}
}

class InlineStandardFontDataFactory {
	baseUrl: string;

	constructor(options: { baseUrl?: string | null }) {
		this.baseUrl = options.baseUrl ?? '';
	}

	async fetch({ filename }: { filename: string }): Promise<Uint8Array> {
		return lookup(decodedFonts, STANDARD_FONT_BASE64, String(filename), '标准字体');
	}
}

/** 内联资源是否可用（构建产物里带了就算可用） */
export function pdfAssetsAvailable(): boolean {
	return CMAP_COUNT > 0 && STANDARD_FONT_COUNT > 0;
}

/** 补上 pdf.js 依赖的新语法，老一点的 Electron 也能跑 */
function ensurePolyfills(): void {
	const promiseWithResolvers = (
		Promise as unknown as {
			withResolvers?: <T>() => {
				promise: Promise<T>;
				resolve: (value: T | PromiseLike<T>) => void;
				reject: (reason?: unknown) => void;
			};
		}
	).withResolvers;
	if (typeof promiseWithResolvers !== 'function') {
		Object.defineProperty(Promise, 'withResolvers', {
			value: function withResolvers<T>() {
				let resolve!: (value: T | PromiseLike<T>) => void;
				let reject!: (reason?: unknown) => void;
				const promise = new Promise<T>((res, rej) => {
					resolve = res;
					reject = rej;
				});
				return { promise, resolve, reject };
			},
			writable: true,
			configurable: true,
		});
	}
}

/** 把内联的 worker 源码变成 Blob URL，只创建一次 */
export function workerBlobUrl(): string {
	if (workerUrl) return workerUrl;
	const blob = new Blob([workerSource], { type: 'text/javascript' });
	workerUrl = URL.createObjectURL(blob);
	return workerUrl;
}

export function configurePdfWorker(): void {
	ensurePolyfills();
	pdfjs.GlobalWorkerOptions.workerSrc = workerBlobUrl();
}

export interface LoadedPdf {
	doc: PDFDocumentProxy;
	pageCount: number;
}

/** 载入一个 PDF，数据由调用方从库内读成字节 */
export async function loadPdf(data: ArrayBuffer): Promise<LoadedPdf> {
	configurePdfWorker();
	const task = pdfjs.getDocument({
		data,
		isEvalSupported: false,
		useSystemFonts: true,
		cMapUrl: '',
		cMapPacked: true,
		CMapReaderFactory: InlineCMapReaderFactory,
		standardFontDataUrl: '',
		StandardFontDataFactory: InlineStandardFontDataFactory,
	});
	const doc = await task.promise;
	return { doc, pageCount: doc.numPages };
}

export interface RenderedPage {
	page: PDFPageProxy;
	width: number;
	height: number;
	/** 页面在 PDF 用户空间的尺寸，单位点 */
	pageSize: [number, number];
}

/** pdf.js 的渲染任务，能取消（渲染卡住时用来腾出画布） */
export interface RenderTaskHandle {
	cancel(): void;
}

/** 把某一页画到 canvas 上，返回页面尺寸信息 */
export async function renderPage(
	doc: PDFDocumentProxy,
	pageNumber: number,
	scale: number,
	canvas: HTMLCanvasElement,
	onTask?: (task: RenderTaskHandle) => void,
): Promise<RenderedPage> {
	const page = await doc.getPage(pageNumber);
	const base = page.getViewport({ scale: 1 });
	const viewport = page.getViewport({ scale });
	const ratio = window.devicePixelRatio || 1;

	canvas.width = Math.floor(viewport.width * ratio);
	canvas.height = Math.floor(viewport.height * ratio);
	canvas.style.width = `${Math.floor(viewport.width)}px`;
	canvas.style.height = `${Math.floor(viewport.height)}px`;

	const context = canvas.getContext('2d');
	if (!context) throw new Error('无法获取 canvas 上下文');
	context.setTransform(ratio, 0, 0, ratio, 0, 0);
	context.clearRect(0, 0, viewport.width, viewport.height);

	const task = page.render({ canvasContext: context, viewport });
	onTask?.(task);
	await task.promise;

	return {
		page,
		width: viewport.width,
		height: viewport.height,
		pageSize: [base.width, base.height],
	};
}

export type { PDFDocumentProxy, PDFPageProxy };
