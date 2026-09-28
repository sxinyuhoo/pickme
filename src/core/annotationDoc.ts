import type { AnnotationDoc, AnnotationEntry, PdfAnchorInfo, PdfShape, QA } from './types.ts';
import { shapesOf } from './types.ts';
import type { Rect } from './pdfgeom.ts';
import { parseFrontmatter, stringifyFrontmatter } from './frontmatter.ts';

const ENTRY_HEAD = '## 锚点 ';
const STATUS_OK = '有效';
const STATUS_STALE = '失效';
/** 完整命中文本所在的小节名；多行文字必须落在这里，单行 bullet 存不住换行 */
const HIT_TEXT_SECTION = '命中文本';
/** 单行命中文本摘要的截断长度 */
const HIT_TEXT_LIMIT = 120;
/** 高亮备注的单行 bullet 截断长度 */
const NOTE_LIMIT = 120;

function entryStatusLabel(entry: AnnotationEntry): string {
	return entry.status === 'ok' ? STATUS_OK : STATUS_STALE;
}

/** 形状集合 →「形状」字段取值：框 / 线 / 框+线。老批注走 shapesOf，只有一个 area 时为纯框选 */
function shapeLabel(pdf: PdfAnchorInfo): string {
	const kinds = new Set(shapesOf(pdf).map((s) => s.kind));
	const parts: string[] = [];
	if (kinds.has('area')) parts.push('框');
	if (kinds.has('line')) parts.push('线');
	return parts.join('+') || '框';
}

/** 用户空间矩形 → 归一化矩形（与页面尺寸同向，不做翻转） */
function normFromRect(rect: Rect, pageSize: [number, number]): Rect {
	const [w, h] = pageSize;
	if (!w || !h) return [0, 0, 0, 0];
	return [rect[0] / w, rect[1] / h, rect[2] / w, rect[3] / h];
}

/** 归一化矩形 → 用户空间矩形 */
function rectFromNorm(norm: Rect, pageSize: [number, number]): Rect {
	return [norm[0] * pageSize[0], norm[1] * pageSize[1], norm[2] * pageSize[0], norm[3] * pageSize[1]];
}

/** 多个矩形拼成一行：分号分隔；digits 为小数位，0 表示取整的用户空间坐标 */
function formatRects(rects: Rect[], digits: number): string {
	return rects
		.map((r) => r.map((n) => (digits > 0 ? n.toFixed(digits) : String(Math.round(n)))).join(','))
		.join(';');
}

/** 解析分号分隔的矩形串；坏掉的片段跳过而不是抛错 */
function parseRects(text: string | undefined): Rect[] {
	const rects: Rect[] = [];
	for (const chunk of (text ?? '').split(';')) {
		const parts = chunk.split(',').map((n) => Number(n));
		if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) continue;
		rects.push([parts[0], parts[1], parts[2], parts[3]]);
	}
	return rects;
}

/** 命中文本的单行摘要：只留首行，换行折叠成空格，超长截断 */
function hitTextSummary(text: string): string {
	const oneLine = (text.split('\n')[0] ?? '').trim().replace(/\s+/g, ' ');
	return oneLine.length > HIT_TEXT_LIMIT ? oneLine.slice(0, HIT_TEXT_LIMIT) : oneLine;
}

/** 备注的单行文本：换行折叠成空格，超长截断，保证落盘是单个 bullet */
function noteSummary(text: string): string {
	const oneLine = text.replace(/\s+/g, ' ').trim();
	return oneLine.length > NOTE_LIMIT ? oneLine.slice(0, NOTE_LIMIT) : oneLine;
}

/** 单条批注渲染为 Markdown 片段 */
export function renderEntry(entry: AnnotationEntry): string {
	const lines: string[] = [`${ENTRY_HEAD}${entry.id}`, ''];
	const kind = entry.kind === 'pdf' ? 'PDF 区域' : '文本';
	lines.push(`- 类型：${kind}`);
	if (entry.kind === 'text') {
		lines.push(`- 选区：${entry.selection}`);
	}
	// 高亮备注：只在非空时落成单个 bullet，空备注不写，老文件逐字节不变
	if (entry.note) lines.push(`- 备注：${noteSummary(entry.note)}`);
	if (entry.pdf) lines.push(`- 形状：${shapeLabel(entry.pdf)}`);
	lines.push(`- 锚点 id：${entry.id}`);
	// 兜底：字段缺失时宁可不写，也不要在文件里留下 undefined 这种字面量
	lines.push(`- 定位指纹：${entry.fingerprint ?? ''}`);
	lines.push(`- 状态：${entryStatusLabel(entry)}`);
	lines.push(`- 创建：${entry.created ?? ''}`);
	if (entry.pdf) {
		const pdf = entry.pdf;
		const shapes = shapesOf(pdf);
		const lineShapes = shapes.filter((s) => s.kind === 'line');
		const areaShapes = shapes.filter((s) => s.kind === 'area');
		lines.push(`- 页码：${pdf.page}`);
		lines.push(`- 页面尺寸：${pdf.pageSize[0]}x${pdf.pageSize[1]}`);
		lines.push(`- 矩形：${pdf.rect.join(',')}`);
		lines.push(`- 归一化矩形：${pdf.normRect.map((n) => n.toFixed(4)).join(',')}`);
		// 线形状与框形状分开写：线用「荧光行」，框用「框」，都支持分号分隔的多个
		if (lineShapes.length) {
			lines.push(`- 荧光行：${formatRects(lineShapes.map((s) => s.rect), 0)}`);
			lines.push(`- 归一化荧光行：${formatRects(lineShapes.map((s) => s.norm), 4)}`);
		}
		if (areaShapes.length) {
			lines.push(`- 框：${formatRects(areaShapes.map((s) => s.rect), 0)}`);
			lines.push(`- 归一化框：${formatRects(areaShapes.map((s) => s.norm), 4)}`);
		}
		if (pdf.color) lines.push(`- 颜色：${pdf.color}`);
		if (pdf.rotation) lines.push(`- 页面旋转：${pdf.rotation}`);
		if (pdf.hitText) lines.push(`- 命中文本：${hitTextSummary(pdf.hitText)}`);
		if (pdf.image) lines.push('', `![[${pdf.image}]]`);
	}
	// 完整命中文本单独成节：单行 bullet 里塞多行文字，落盘后再解析只剩第一行
	if (entry.pdf?.hitText) {
		lines.push('', `### ${HIT_TEXT_SECTION}`, '', entry.pdf.hitText);
	}

	entry.qas.forEach((qa, index) => {
		lines.push('');
		if (index === 0) {
			lines.push('### 提问', '', qa.question);
			lines.push('', '### 模板', '', qa.template || '（直接提问）');
			lines.push('', '### 回答', '', qa.answer);
		} else {
			lines.push(`### 追问 ${index}`, '', `问：${qa.question}`, `答：${qa.answer}`);
		}
	});
	lines.push('');
	return lines.join('\n');
}

/** 整个批注文件渲染为 Markdown */
export function renderAnnotationDoc(doc: AnnotationDoc): string {
	const sourceName = doc.sourcePath.split('/').pop() ?? doc.sourcePath;
	const link = sourceName.replace(/\.md$/, '');
	const frontmatter: Record<string, string | number> = {
		类型: 'pickme 批注',
		源文档: `[[${link}]]`,
		源路径: doc.sourcePath,
		源类型: doc.sourceType === 'pdf' ? 'pdf' : 'markdown',
		批注版本: 1,
		创建: doc.created,
		更新: doc.updated,
		批注条数: doc.entries.length,
	};
	const body = [`源文档：[[${link}]]`, '', ...doc.entries.map((entry) => renderEntry(entry))].join('\n');
	return stringifyFrontmatter(frontmatter, body);
}

interface KVs {
	values: Map<string, string>;
	sections: Map<string, string[]>;
	/** 小节标题之前的正文行，PDF 区域截图就放在这里 */
	head: string[];
}

function splitBlocks(body: string): string[] {
	const blocks: string[] = [];
	let current: string[] | null = null;
	for (const line of body.split('\n')) {
		if (line.startsWith(ENTRY_HEAD)) {
			if (current) blocks.push(current.join('\n'));
			current = [line];
			continue;
		}
		if (current) current.push(line);
	}
	if (current) blocks.push(current.join('\n'));
	return blocks;
}

function parseBlock(block: string): KVs {
	const values = new Map<string, string>();
	const sections = new Map<string, string[]>();
	const head: string[] = [];
	let currentSection: string | null = null;

	for (const rawLine of block.split('\n')) {
		const line = rawLine.trimEnd();
		if (line.startsWith('### ')) {
			currentSection = line.slice(4).trim();
			sections.set(currentSection, []);
			continue;
		}
		if (currentSection) {
			sections.get(currentSection)?.push(line);
			continue;
		}
		head.push(line);
		const bullet = line.match(/^-\s*([^：]+)：(.*)$/);
		if (bullet) values.set(bullet[1].trim(), bullet[2].trim());
	}
	return { values, sections, head };
}

function sectionText(sections: Map<string, string[]>, name: string): string {
	const lines = sections.get(name);
	if (!lines) return '';
	return lines.join('\n').trim();
}

/** 解析批注文件，容错优先：解析不了的条目跳过而不是抛错 */
export function parseAnnotationDoc(text: string, selfPath: string): AnnotationDoc {
	const { data, body } = parseFrontmatter(text);
	const sourcePath = data['源路径'] ?? '';
	const sourceTypeText = data['源类型'] ?? 'markdown';
	const entries: AnnotationEntry[] = [];

	for (const block of splitBlocks(body)) {
		const { values, sections, head } = parseBlock(block);
		const id = block.split('\n')[0].slice(ENTRY_HEAD.length).trim();
		if (!id) continue;
		const kind = values.get('类型') === 'PDF 区域' ? 'pdf' : 'text';
		const entry: AnnotationEntry = {
			id,
			kind,
			selection: values.get('选区') ?? '',
			fingerprint: values.get('定位指纹') ?? '',
			status: values.get('状态') === STATUS_STALE ? 'stale' : 'ok',
			created: values.get('创建') ?? '',
			qas: [],
		};
		// 高亮备注：没有这个 bullet 就保持 undefined，不凭空造字段
		const note = (values.get('备注') ?? '').trim();
		if (note) entry.note = note;
		if (kind === 'pdf') {
			entry.pdf = parsePdfInfo(values, sections, head);
		}

		const question = sectionText(sections, '提问');
		const template = sectionText(sections, '模板');
		const answer = sectionText(sections, '回答');
		if (question || answer) {
			entry.qas.push({
				question,
				template: template === '（直接提问）' ? '' : template,
				answer,
				created: entry.created,
			});
		}
		for (const [name, lines] of sections) {
			const match = name.match(/^追问\s*(\d+)$/);
			if (!match) continue;
			const text = lines.join('\n').trim();
			const q = text.match(/问：([\s\S]*?)(?:\n答：|$)/);
			const a = text.match(/答：([\s\S]*)$/);
			entry.qas.push({
				question: q ? q[1].trim() : '',
				template: '',
				answer: a ? a[1].trim() : '',
				created: entry.created,
			});
		}
		entries.push(entry);
	}

	return {
		sourcePath,
		sourceType: sourceTypeText === 'pdf' ? 'pdf' : 'md',
		selfPath,
		created: data['创建'] ?? '',
		updated: data['更新'] ?? '',
		entries,
	};
}

/**
 * 形状集合的解析：以归一化字段为准，缺失时用用户空间字段按页面尺寸换算。
 * 两者都没有（老批注）时留 undefined，交由 shapesOf 退化成单个框。
 */
function parseShapes(values: Map<string, string>, pageSize: [number, number]): PdfShape[] | undefined {
	const normLines = parseRects(values.get('归一化荧光行'));
	const normAreas = parseRects(values.get('归一化框'));
	if (normLines.length || normAreas.length) {
		return [
			...normLines.map((norm): PdfShape => ({ kind: 'line', norm, rect: rectFromNorm(norm, pageSize) })),
			...normAreas.map((norm): PdfShape => ({ kind: 'area', norm, rect: rectFromNorm(norm, pageSize) })),
		];
	}
	const rawLines = parseRects(values.get('荧光行'));
	const rawAreas = parseRects(values.get('框'));
	if (rawLines.length || rawAreas.length) {
		return [
			...rawLines.map((rect): PdfShape => ({ kind: 'line', rect, norm: normFromRect(rect, pageSize) })),
			...rawAreas.map((rect): PdfShape => ({ kind: 'area', rect, norm: normFromRect(rect, pageSize) })),
		];
	}
	return undefined;
}

function parsePdfInfo(
	values: Map<string, string>,
	sections: Map<string, string[]>,
	head: string[],
): PdfAnchorInfo {
	const size = (values.get('页面尺寸') ?? '').split('x').map((n) => Number(n));
	const rect = (values.get('矩形') ?? '').split(',').map((n) => Number(n));
	const norm = (values.get('归一化矩形') ?? '').split(',').map((n) => Number(n));
	const image = head.join('\n').match(/!\[\[([^\]]+)\]\]/)?.[1] ?? '';
	const pageSize: [number, number] = [size[0] || 0, size[1] || 0];
	const pdf: PdfAnchorInfo = {
		page: Number(values.get('页码') ?? 1),
		pageSize,
		rect: [rect[0] || 0, rect[1] || 0, rect[2] || 0, rect[3] || 0],
		normRect: [norm[0] || 0, norm[1] || 0, norm[2] || 0, norm[3] || 0],
		// 命中文本优先取小节里的完整文字，没有小节才回退到单行 bullet
		hitText: sectionText(sections, HIT_TEXT_SECTION) || (values.get('命中文本') ?? ''),
		image,
	};
	const shapes = parseShapes(values, pageSize);
	if (shapes) pdf.shapes = shapes;
	const color = (values.get('颜色') ?? '').trim();
	if (color) pdf.color = color;
	const rotation = Number(values.get('页面旋转'));
	if (Number.isFinite(rotation) && rotation !== 0) pdf.rotation = rotation;
	return pdf;
}

export function countQAs(entries: AnnotationEntry[]): number {
	return entries.reduce((sum: number, entry) => sum + entry.qas.length, 0);
}

export type { QA };
