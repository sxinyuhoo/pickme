/** 纯数据模型，不依赖 Obsidian API */

import type { Rect } from './pdfgeom.ts';

export interface QA {
	/** 提问内容 */
	question: string;
	/** 使用的模板名，直接提问时为空 */
	template: string;
	/** 模型回答的原文 */
	answer: string;
	/** ISO 时间戳 */
	created: string;
}

/** PDF 标注方式：荧光笔（拖一笔吸附到文字行）还是框选 */
export type PdfAnnotateMode = 'highlight' | 'area';

/** 一条 PDF 批注里的单个形状 */
export type PdfShapeKind = 'area' | 'line';

export interface PdfShape {
	kind: PdfShapeKind;
	/** PDF 用户空间矩形，左下为原点 */
	rect: Rect;
	/** 归一化矩形，0 到 1 */
	norm: Rect;
}

export interface PdfAnchorInfo {
	/** 页码，从 1 开始 */
	page: number;
	/** 页面尺寸，单位点 */
	pageSize: [number, number];
	/** PDF 用户空间矩形，左下为原点（外接矩形） */
	rect: [number, number, number, number];
	/** 归一化矩形，0 到 1（外接矩形） */
	normRect: [number, number, number, number];
	/** 形状集合；缺省时视为单个 area 形状（老批注兼容） */
	shapes?: PdfShape[];
	/** 该条批注的颜色；缺省时用设置里的高亮色 */
	color?: string;
	/**
	 * 页面旋转角（0/90/180/270）。
	 * 老批注没有这个字段，读取时按 0 处理，渲染坐标与修复前逐位一致。
	 */
	rotation?: number;
	/** 矩形范围内的命中文本，可能为空 */
	hitText: string;
	/** 区域截图在库内的相对路径，可能为空 */
	image: string;
}

/** 形状集合的归一化读取：没有 shapes 字段的老批注退化成单个框 */
export function shapesOf(pdf: PdfAnchorInfo): PdfShape[] {
	if (pdf.shapes && pdf.shapes.length) return pdf.shapes;
	return [{ kind: 'area', rect: pdf.rect, norm: pdf.normRect }];
}

/** 形状组合的短称，返回中文原文（调用处再交给 t() 翻译） */
export function shapeKindLabel(pdf: PdfAnchorInfo): string {
	const shapes = shapesOf(pdf);
	const hasLine = shapes.some((shape) => shape.kind === 'line');
	const hasArea = shapes.some((shape) => shape.kind === 'area');
	if (hasLine && hasArea) return '框+线';
	return hasLine ? '荧光' : '框选';
}

export interface AnnotationEntry {
	/** 锚点 id，与原文中的 <pickme id="..."> 一致 */
	id: string;
	kind: 'text' | 'pdf';
	/** 文本锚点的选区原文，PDF 锚点为空 */
	selection: string;
	/** 选区文本的指纹，用于失效检测 */
	fingerprint: string;
	/** 锚点状态 */
	status: 'ok' | 'stale';
	created: string;
	qas: QA[];
	pdf?: PdfAnchorInfo;
}

export interface AnnotationDoc {
	/** 源文档在库内的路径 */
	sourcePath: string;
	sourceType: 'md' | 'pdf';
	/** 批注文件在库内的路径 */
	selfPath: string;
	created: string;
	updated: string;
	entries: AnnotationEntry[];
}

/** 扫描出的一个完整锚点区间 */
export interface AnchorPair {
	id: string;
	/** 选区文字在文件中的起始偏移 */
	start: number;
	/** 选区文字在文件中的结束偏移 */
	end: number;
	text: string;
}

export interface ScanResult {
	pairs: AnchorPair[];
	/** 缺少 id 或写法不合法的标签个数 */
	malformed: number;
	/** 标签数量不等于 2 的 id 列表，这些锚点损坏 */
	broken: string[];
}

export type EntryMatch = 'ok' | 'rebind' | 'stale';

export interface EntryLike {
	id: string;
	selection: string;
}
