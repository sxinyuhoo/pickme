/**
 * PDF 目录（大纲）的扁平化：pdf.js 的 outline 是树，界面上要按层级平铺。
 * 浮动页码由调用方异步解析好（pdf.js 的 dest 要先 getDestination + getPageIndex），
 * 这里只负责结构与层级，便于单测。
 */

export interface RawOutlineItem {
	title?: string;
	dest?: unknown;
	items?: RawOutlineItem[];
}

export interface TocEntry {
	/** 目录文字 */
	title: string;
	/** 层级，0 起 */
	depth: number;
	/** 目标页（1 起）；解析不出来就是 null，点了不跳 */
	page: number | null;
}

/**
 * 把一个目录节点树摊平成一串带层级的条目。
 * 空标题的节点本身不显示，但它的子项照常展开（有些 PDF 用空标题当分组）。
 */
export function flattenOutline(
	items: RawOutlineItem[],
	resolvePage: (item: RawOutlineItem) => number | null,
	depth = 0,
): TocEntry[] {
	const out: TocEntry[] = [];
	for (const item of items) {
		const title = (item.title ?? '').trim();
		if (title) out.push({ title, depth, page: resolvePage(item) });
		if (item.items && item.items.length > 0) {
			out.push(...flattenOutline(item.items, resolvePage, depth + 1));
		}
	}
	return out;
}
