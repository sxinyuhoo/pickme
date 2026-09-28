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

/** 笔迹上的一个采样点，PDF 用户空间（左下为原点，与 TextItemBox 同一坐标系） */
export interface StrokePoint {
	x: number;
	y: number;
}

/** 吸附出来的一行：矩形范围 + 命中到的文字项（供取文字用） */
export interface LineBox {
	rect: Rect;
	items: TextItemBox[];
}

/**
 * 沿笔迹补采样的步长（PDF 点）。pointermove 事件之间可能隔了几十上百点，
 * 只在事件点之间做判定会整行漏掉，所以按线段每 2px 补一个采样点。
 */
const STROKE_SAMPLE_STEP = 2;

/** 笔迹起止各丢弃的长度（点）：起笔收笔的手抖会多带出一个字的量 */
const STROKE_TRIM = 4;

/** 行带下沿系数，与 intersectsRect 一致（y 是基线，字向上生长） */
const BAND_BOTTOM = 0.3;

/** 行带上沿系数 */
const BAND_TOP = 0.8;

/** 命中的横向/纵向容差：压着边线也算命中 */
const HIT_TOLERANCE = 1;

/** 同基线合并容差系数，与 joinItemText 一致 */
const LINE_MERGE_FACTOR = 0.6;

/** 行内相邻文字项的断开阈值 max(2.5h, 18pt)：双栏中缝、表格列靠它断开 */
const ITEM_GAP_FACTOR = 2.5;
const ITEM_GAP_MIN = 18;

/** 字高的兜底值，与 joinItemText 里 max(height, 4) 的口径一致 */
const MIN_TEXT_HEIGHT = 4;

/** 沿折线每 step 补一个采样点，保证相邻点之间的线段足够短 */
function resampleStroke(points: StrokePoint[], step: number): StrokePoint[] {
	const out: StrokePoint[] = [{ x: points[0].x, y: points[0].y }];
	for (let i = 1; i < points.length; i++) {
		const a = points[i - 1];
		const b = points[i];
		const distance = Math.hypot(b.x - a.x, b.y - a.y);
		if (distance > 0) {
			const count = Math.floor(distance / step);
			for (let k = 1; k <= count; k++) {
				const t = (k * step) / distance;
				out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
			}
		}
		out.push({ x: b.x, y: b.y });
	}
	return out;
}

/** 按弧长丢弃首尾各 trim 长度的采样点；整笔比 trim 两倍还短的直接作废 */
function trimStrokeEnds(points: StrokePoint[], trim: number): StrokePoint[] {
	const lengths = [0];
	for (let i = 1; i < points.length; i++) {
		const step = Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
		lengths.push(lengths[i - 1] + step);
	}
	const total = lengths[lengths.length - 1];
	if (total <= trim * 2) return [];
	return points.filter((_, i) => lengths[i] >= trim && lengths[i] <= total - trim);
}

/** 线段与轴对齐矩形是否相交，Liang-Barsky 裁剪 */
function segmentHitsRect(
	a: StrokePoint,
	b: StrokePoint,
	left: number,
	bottom: number,
	right: number,
	top: number,
): boolean {
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	let enter = 0;
	let leave = 1;
	// 每条边给出 p*t <= q 的裁剪条件
	const edges: [number, number][] = [
		[-dx, a.x - left],
		[dx, right - a.x],
		[-dy, a.y - bottom],
		[dy, top - a.y],
	];
	for (const [p, q] of edges) {
		if (p === 0) {
			// 与该边平行：落在带外就整段被裁掉
			if (q < 0) return false;
			continue;
		}
		const t = q / p;
		if (p < 0) {
			if (t > leave) return false;
			if (t > enter) enter = t;
		} else {
			if (t < enter) return false;
			if (t < leave) leave = t;
		}
	}
	return enter <= leave;
}

/**
 * 笔迹是否碰到某个文字项。
 * 横向按该项自身的 x 范围判定（不是整行）：这样「只划了半行」才不会把整行吸进来；
 * 纵向按基线上下各取一段。点的容差之外还要做线段判定，快速拖动时相邻采样点之间没有点。
 */
function strokeHitsItem(item: TextItemBox, points: StrokePoint[]): boolean {
	const left = item.x - HIT_TOLERANCE;
	const right = item.x + item.width + HIT_TOLERANCE;
	const bottom = item.y - item.height * BAND_BOTTOM - HIT_TOLERANCE;
	const top = item.y + item.height * BAND_TOP + HIT_TOLERANCE;
	for (let i = 0; i < points.length; i++) {
		const point = points[i];
		if (point.x >= left && point.x <= right && point.y >= bottom && point.y <= top) return true;
		if (i > 0 && segmentHitsRect(points[i - 1], point, left, bottom, right, top)) return true;
	}
	return false;
}

/** 按基线把命中的文字项归到同一行，容差与 joinItemText 一致 */
function groupByBaseline(items: TextItemBox[]): TextItemBox[][] {
	const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
	const groups: TextItemBox[][] = [];
	for (const item of sorted) {
		const group = groups.find(
			(g) =>
				Math.abs(g[0].y - item.y) <=
				Math.max(g[0].height, item.height, MIN_TEXT_HEIGHT) * LINE_MERGE_FACTOR,
		);
		if (group) group.push(item);
		else groups.push([item]);
	}
	return groups;
}

/** 行内按间距断开成若干段，返回的每段都不会跨越双栏中缝或表格列 */
function splitRuns(items: TextItemBox[]): TextItemBox[][] {
	const sorted = [...items].sort((a, b) => a.x - b.x);
	const runs: TextItemBox[][] = [];
	let run: TextItemBox[] = [];
	for (const item of sorted) {
		if (run.length > 0) {
			const prev = run[run.length - 1];
			const height = Math.max(prev.height, item.height, MIN_TEXT_HEIGHT);
			const gap = item.x - (prev.x + prev.width);
			if (gap > Math.max(height * ITEM_GAP_FACTOR, ITEM_GAP_MIN)) {
				runs.push(run);
				run = [];
			}
		}
		run.push(item);
	}
	if (run.length > 0) runs.push(run);
	return runs;
}

/**
 * 一笔笔迹 → 吸附后的行框，按阅读顺序（先上后下、再左到右）。
 * items 是整页的文字项，points 是笔迹采样点，两者都在 PDF 用户空间。
 * 空白处、单击（点数 < 2）、短到只剩手抖的笔迹都返回空数组。
 */
export function strokeToLines(items: TextItemBox[], points: StrokePoint[]): LineBox[] {
	if (points.length < 2) return [];
	const stroke = trimStrokeEnds(resampleStroke(points, STROKE_SAMPLE_STEP), STROKE_TRIM);
	if (stroke.length < 2) return [];
	const hit = items.filter((item) => item.str.trim() !== '' && strokeHitsItem(item, stroke));
	if (hit.length === 0) return [];

	const lines: LineBox[] = [];
	for (const group of groupByBaseline(hit)) {
		// 同一基线上还可能横跨中缝（双栏、表格列），再按行内间距断开
		for (const run of splitRuns(group)) {
			const height = Math.max(...run.map((item) => item.height), MIN_TEXT_HEIGHT);
			// 基线取行内字高最大的那一项（主字号），免得下标把整条带往下拖
			const base = run.reduce((best, item) => (item.height > best.height ? item : best), run[0]).y;
			// 横向只覆盖命中项，不做整行吸附
			const x0 = Math.min(...run.map((item) => item.x));
			const x1 = Math.max(...run.map((item) => item.x + item.width));
			lines.push({
				rect: [x0, base - height * BAND_BOTTOM, x1, base + height * BAND_TOP],
				items: run,
			});
		}
	}
	return lines.sort((a, b) => b.rect[3] - a.rect[3] || a.rect[0] - b.rect[0]);
}

/** 行框集合 → 文本：每行用 joinItemText 拼，行间换行 */
export function linesText(lines: LineBox[]): string {
	return lines.map((line) => joinItemText(line.items)).join('\n');
}
