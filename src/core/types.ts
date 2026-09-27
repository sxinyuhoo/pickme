/** 纯数据模型，不依赖 Obsidian API */

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

export interface PdfAnchorInfo {
	/** 页码，从 1 开始 */
	page: number;
	/** 页面尺寸，单位点 */
	pageSize: [number, number];
	/** PDF 用户空间矩形，左下为原点 */
	rect: [number, number, number, number];
	/** 归一化矩形，0 到 1 */
	normRect: [number, number, number, number];
	/** 矩形范围内的命中文本，可能为空 */
	hitText: string;
	/** 区域截图在库内的相对路径，可能为空 */
	image: string;
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
