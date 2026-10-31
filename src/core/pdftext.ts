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

/** 行带横向的外扩容差：笔迹起止点各向外留一点，免得文字边缘差一丝没盖住 */
const HIGHLIGHT_PAD = 1;

/** 行带最小横向宽度：竖划或极短笔迹也要给出一个能看见的宽度，避免零宽行带 */
const HIGHLIGHT_MIN_WIDTH = 4;

/**
 * 「以竖向为主的一笔 = 整行」判定之一：本行上笔迹的横向跨度小于该行字高的这个比例，
 * 才算这一行上横向几乎没动。
 */
const VERTICAL_STROKE_SPAN_FACTOR = 0.5;

/** 判定之二：整笔纵向跨度 >= 系数 × 横向跨度 + 字高，才算「以竖向为主」，避免把斜划当竖划 */
const VERTICAL_STROKE_RATIO = 2;

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
 * 笔迹落在某一行带内的横向跨度（min x / max x）。
 * 只按纵向带过滤：横向划出文字项之外的部分留给调用处夹回命中项范围。
 * 一个采样点都没落进带内时返回 null，调用处退回命中项的整段范围。
 */
function strokeSpanInBand(
	sampled: StrokePoint[],
	bottom: number,
	top: number,
): [number, number] | null {
	let min = Infinity;
	let max = -Infinity;
	for (const point of sampled) {
		if (point.y < bottom || point.y > top) continue;
		if (point.x < min) min = point.x;
		if (point.x > max) max = point.x;
	}
	return min <= max ? [min, max] : null;
}

/** 整笔的横向范围 [left, right]，补间时用来判断某一行是否与笔迹有横向交集 */
function strokeHorizontalRange(points: StrokePoint[]): [number, number] {
	let left = Infinity;
	let right = -Infinity;
	for (const point of points) {
		if (point.x < left) left = point.x;
		if (point.x > right) right = point.x;
	}
	return [left, right];
}

/**
 * 笔迹在某个基线高度上的横坐标：找跨过该 y 的线段做线性插值。
 * 快速划过多行时中间几行一整个命中项都没有，只能靠这个位置把行带补回去；
 * 该 y 没被任何线段跨过（笔迹没经过这条基线）时返回 null。
 */
function strokeXAtY(points: StrokePoint[], y: number): number | null {
	for (let i = 1; i < points.length; i++) {
		const a = points[i - 1];
		const b = points[i];
		if (a.y === b.y) {
			if (a.y === y) return a.x;
			continue;
		}
		// 两端落在基线同一侧：这一小段没跨过该 y
		if ((a.y - y) * (b.y - y) > 0) continue;
		const t = (y - a.y) / (b.y - a.y);
		if (t < 0 || t > 1) continue;
		return a.x + (b.x - a.x) * t;
	}
	return null;
}

/** 整笔在横/纵方向上的跨度，用来识别「以竖向为主」的一笔 */
function strokeExtent(points: StrokePoint[]): { width: number; height: number } {
	let minX = Infinity;
	let maxX = -Infinity;
	let minY = Infinity;
	let maxY = -Infinity;
	for (const point of points) {
		if (point.x < minX) minX = point.x;
		if (point.x > maxX) maxX = point.x;
		if (point.y < minY) minY = point.y;
		if (point.y > maxY) maxY = point.y;
	}
	return { width: maxX - minX, height: maxY - minY };
}

/**
 * 一行文字项 → 行带（矩形夹住命中项范围）。
 * anchor 为 null 时是笔迹真划中的行：横向取笔迹在该行带内的跨度；
 * 给了 anchor 就是补间出来的行（笔迹没划中），只按插值出来的落点给出一个窄带。
 */
function buildLineBox(
	sampled: StrokePoint[],
	run: TextItemBox[],
	extent: { width: number; height: number },
	anchor: number | null = null,
): LineBox {
	const height = Math.max(...run.map((item) => item.height), MIN_TEXT_HEIGHT);
	// 基线取行内字高最大的那一项（主字号），免得下标把整条带往下拖
	const base = run.reduce((best, item) => (item.height > best.height ? item : best), run[0]).y;
	// 横向只覆盖命中项范围（双栏断开后的一段）
	const itemLeft = Math.min(...run.map((item) => item.x));
	const itemRight = Math.max(...run.map((item) => item.x + item.width));
	let x0 = itemLeft;
	let x1 = itemRight;
	if (anchor === null) {
		// 笔迹在本行带上的横向跨度，再夹进命中项范围：划多少算多少，不整项铺满
		const span = strokeSpanInBand(
			sampled,
			base - height * BAND_BOTTOM - HIT_TOLERANCE,
			base + height * BAND_TOP + HIT_TOLERANCE,
		);
		if (span) {
			x0 = Math.max(itemLeft, span[0] - HIGHLIGHT_PAD);
			x1 = Math.min(itemRight, span[1] + HIGHLIGHT_PAD);
		}
		// 竖向为主的笔画（纵向跨多行、横向几乎不动）：这一行改用命中项的完整范围，
		// 而不是笔迹跨度 —— 竖着往下拖就等于「整行整行地划」，不再只留一个几 pt 宽的细条。
		const spanWidth = span ? span[1] - span[0] : 0;
		if (
			spanWidth < height * VERTICAL_STROKE_SPAN_FACTOR &&
			extent.height >= extent.width * VERTICAL_STROKE_RATIO + height
		) {
			x0 = itemLeft;
			x1 = itemRight;
		}
	} else {
		// 补间行：笔迹确实跨过这条基线，但从文字旁边掠过去了。
		// 只按插值点给 ±1pt 的话只有 2~4pt 宽，肉眼等于没补上，
		// 所以取该项范围 ∩ 笔迹整体横向包围盒，再把插值落点并进去。
		const [strokeLeft, strokeRight] = strokeHorizontalRange(sampled);
		const at = Math.min(Math.max(anchor, itemLeft), itemRight);
		x0 = Math.max(itemLeft, Math.min(at - HIGHLIGHT_PAD, strokeLeft - HIGHLIGHT_PAD));
		x1 = Math.min(itemRight, Math.max(at + HIGHLIGHT_PAD, strokeRight + HIGHLIGHT_PAD));
	}
	// 竖划或极短笔迹会算出零宽，撑到最小宽度后再夹回命中项范围
	if (x1 - x0 < HIGHLIGHT_MIN_WIDTH) {
		const mid = (x0 + x1) / 2;
		x0 = Math.max(itemLeft, mid - HIGHLIGHT_MIN_WIDTH / 2);
		x1 = Math.min(itemRight, mid + HIGHLIGHT_MIN_WIDTH / 2);
	}
	return {
		rect: [x0, base - height * BAND_BOTTOM, x1, base + height * BAND_TOP],
		items: run,
	};
}

/**
 * 补间：一笔快速划过多行时 pointermove 事件会被吞，中间几行一个命中项都没有，
 * 结果只有首尾行亮起来。在命中行基线的最大/最小值之间，把页面里既没被笔迹碰到、
 * 又与笔迹横向有交集的行补成行带 —— 用户的要求是「哪怕没画中也补上中间空白」。
 * 横向取笔迹在该基线上的插值位置，插不出来（笔迹没跨过该 y）就不补。
 */
function tweenLines(
	all: TextItemBox[],
	hitGroups: TextItemBox[][],
	sampled: StrokePoint[],
	extent: { width: number; height: number },
): LineBox[] {
	// 单行命中不补：首尾之间没有可供插值的行
	if (hitGroups.length < 2) return [];
	const bases = hitGroups.map(
		(group) => group.reduce((best, item) => (item.height > best.height ? item : best), group[0]).y,
	);
	const top = Math.max(...bases);
	const bottom = Math.min(...bases);
	if (top - bottom <= 0) return [];
	const hitItems = new Set(hitGroups.flat());
	const [strokeLeft, strokeRight] = strokeHorizontalRange(sampled);
	const lines: LineBox[] = [];
	for (const group of groupByBaseline(all.filter((item) => item.str.trim() !== ''))) {
		// 已经被笔迹命中的行不重复补
		if (group.some((item) => hitItems.has(item))) continue;
		const base = group.reduce((best, item) => (item.height > best.height ? item : best), group[0]).y;
		// 只看首尾命中行「之间」的行，两端之外不补
		if (base <= bottom || base >= top) continue;
		const anchor = strokeXAtY(sampled, base);
		if (anchor === null) continue;
		// 同一基线上可能横跨中缝，逐段判断：另一栏、页边栏与笔迹没有横向交集，不补
		for (const run of splitRuns(group)) {
			const runLeft = Math.min(...run.map((item) => item.x));
			const runRight = Math.max(...run.map((item) => item.x + item.width));
			if (runRight < strokeLeft || runLeft > strokeRight) continue;
			lines.push(buildLineBox(sampled, run, extent, anchor));
		}
	}
	return lines;
}

/**
 * 一笔笔迹 → 吸附后的行框，按阅读顺序（先上后下、再左到右）。
 * items 是整页的文字项，points 是笔迹采样点，两者都在 PDF 用户空间。
 * 空白处、单击（点数 < 2）、短到只剩手抖的笔迹都返回空数组。
 */
export function strokeToLines(items: TextItemBox[], points: StrokePoint[]): LineBox[] {
	if (points.length < 2) return [];
	const sampled = resampleStroke(points, STROKE_SAMPLE_STEP);
	const stroke = trimStrokeEnds(sampled, STROKE_TRIM);
	if (stroke.length < 2) return [];
	const hit = items.filter((item) => item.str.trim() !== '' && strokeHitsItem(item, stroke));
	if (hit.length === 0) return [];

	// 整笔的横/纵跨度：用于「竖向为主的一笔 = 整行」的判定
	const extent = strokeExtent(sampled);

	// 命中的行按基线成组；同一基线上还可能横跨中缝（双栏、表格列），再按行内间距断开
	const hitGroups = groupByBaseline(hit);
	const lines: LineBox[] = [];
	for (const group of hitGroups) {
		for (const run of splitRuns(group)) lines.push(buildLineBox(sampled, run, extent));
	}
	// 命中行之间被事件吞掉的行补回来：首尾行本身的矩形不受影响
	lines.push(...tweenLines(items, hitGroups, sampled, extent));
	return lines.sort((a, b) => b.rect[3] - a.rect[3] || a.rect[0] - b.rect[0]);
}

/** 行框集合 → 文本：每行用 joinItemText 拼，行间换行 */
export function linesText(lines: LineBox[]): string {
	return lines.map((line) => joinItemText(line.items)).join('\n');
}
