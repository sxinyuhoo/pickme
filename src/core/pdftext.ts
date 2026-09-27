import type { Rect } from './pdfgeom.ts';
import { normalizeRect } from './pdfgeom.ts';

export interface Point {
	x: number;
	y: number;
}

/** pdf.js getTextContent 里一项的原始形状 */
export interface RawTextItem {
	str: string;
	transform: number[];
	width: number;
	height: number;
}

/** 换算成 PDF 用户空间里的方框，基线在 y，字向上生长 */
export interface TextItemBox {
	str: string;
	x: number;
	y: number;
	width: number;
	height: number;
}

export function itemBox(item: RawTextItem): TextItemBox {
	return {
		str: item.str,
		x: item.transform[4] ?? 0,
		y: item.transform[5] ?? 0,
		width: item.width,
		height: item.height,
	};
}

/** 拖拽起止点换算成矩形 */
export function dragRect(a: Point, b: Point): Rect {
	return normalizeRect([a.x, a.y, b.x, b.y]);
}

/** 框选区域是否够大，避免误点生成空批注 */
export function hasMinimumSize(rect: Rect, min: number): boolean {
	const [x1, y1, x2, y2] = normalizeRect(rect);
	return x2 - x1 >= min && y2 - y1 >= min;
}

/** 文字方框与选区是否相交，纵向按基线上下各取一段 */
export function intersectsRect(box: TextItemBox, rect: Rect): boolean {
	const [x1, y1, x2, y2] = normalizeRect(rect);
	const boxLeft = box.x;
	const boxRight = box.x + box.width;
	const boxBottom = box.y - box.height * 0.3;
	const boxTop = box.y + box.height * 0.8;
	return boxLeft < x2 && boxRight > x1 && boxBottom < y2 && boxTop > y1;
}

/** 取出落在选区里的文字项，按阅读顺序排列（先上后下、先左后右） */
export function itemsInRect(items: TextItemBox[], rect: Rect): TextItemBox[] {
	return items
		.filter((item) => item.str.trim() !== '' && intersectsRect(item, rect))
		.sort((a, b) => {
			const lineDelta = b.y - a.y;
			if (Math.abs(lineDelta) > Math.max(a.height, b.height, 4) * 0.6) return lineDelta;
			return a.x - b.x;
		});
}

/** 把文字项拼成文本，同一行内按间距决定是否补空格 */
export function joinItemText(items: TextItemBox[]): string {
	const lines: string[] = [];
	let current = '';
	let lineY: number | null = null;
	let prevRight: number | null = null;

	for (const item of items) {
		const sameLine =
			lineY !== null && Math.abs(item.y - lineY) <= Math.max(item.height, 4) * 0.6;
		if (!sameLine) {
			if (current) lines.push(current);
			current = item.str;
			lineY = item.y;
		} else {
			const gap = prevRight === null ? 0 : item.x - prevRight;
			const needsSpace = gap > Math.max(item.height, 4) * 0.3;
			current += `${needsSpace ? ' ' : ''}${item.str}`;
		}
		prevRight = item.x + item.width;
	}
	if (current) lines.push(current);
	return lines.join('\n').trim();
}

/** 把 pdf.js 的文字内容直接转成选区里的文本 */
export function textInRect(rawItems: RawTextItem[], rect: Rect): string {
	return joinItemText(itemsInRect(rawItems.map(itemBox), rect));
}
