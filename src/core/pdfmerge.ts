import type { Rect } from './pdfgeom.ts';

/** 可参与「续划合并」的已有高亮：本页已有的行带 */
export interface MergeTarget {
	id: string;
	page: number;
	bands: Rect[]; // 该高亮在本页已有的行带，page 坐标
}

/** 起笔点与已有行带的纵向邻近容差（字高倍数）：上/下一行紧邻都能命中 */
const NEAR_LINE_FACTOR = 1.5;

/** 起笔点与已有行带的横向容差（PDF 点），与 HIGHLIGHT_PAD 同量级 */
const NEAR_PAD = 1;

/** 同一基线的判定容差（字高倍数），与 joinItemText / groupByBaseline 一致 */
const SAME_LINE_FACTOR = 0.6;

/** 字高兜底值：lineHeight 缺失或过小时，容差不能塌成 0 */
const MIN_LINE_HEIGHT = 4;

/**
 * 起笔点落在哪条已有高亮上（或紧邻它上/下 1.5 倍字高、且横向与某条行带有重叠）→ 返回该条 id；都不匹配返回 null。
 * 只看同页；命中多条时选纵向距离最近的那条。
 */
export function pickMergeTarget(
	targets: MergeTarget[],
	page: number,
	start: { x: number; y: number },
	lineHeight: number,
): string | null {
	const h = Math.max(lineHeight, MIN_LINE_HEIGHT);
	let bestId: string | null = null;
	let bestDist = Infinity;
	for (const target of targets) {
		if (target.page !== page) continue;
		for (const band of target.bands) {
			// 横向：起笔点要落在行带左右各 ±pad 之内，否则算错开
			if (start.x < band[0] - NEAR_PAD || start.x > band[2] + NEAR_PAD) continue;
			// 纵向：起笔点落在行带上下各 1.5 倍字高之内（本行、上一行、下一行都命中）
			if (
				start.y < band[1] - NEAR_LINE_FACTOR * h ||
				start.y > band[3] + NEAR_LINE_FACTOR * h
			) {
				continue;
			}
			// 纵向距离：点在带内为 0，带外取到最近一条边的距离
			const dist =
				start.y < band[1] ? band[1] - start.y : start.y > band[3] ? start.y - band[3] : 0;
			if (dist < bestDist) {
				bestDist = dist;
				bestId = target.id;
			}
		}
	}
	return bestId;
}

/** 若干行带的并集 */
function unionRects(rects: Rect[]): Rect {
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	for (const r of rects) {
		if (r[0] < minX) minX = r[0];
		if (r[1] < minY) minY = r[1];
		if (r[2] > maxX) maxX = r[2];
		if (r[3] > maxY) maxY = r[3];
	}
	return [minX, minY, maxX, maxY];
}

/** 行带纵向中点，作为基线位置的代理（行带 = [base-0.3h, base+0.8h]） */
function bandMidY(band: Rect): number {
	return (band[1] + band[3]) / 2;
}

/** 把新划的行带并进已有行带：落在同一基线（0.6 倍字高容差）的只留一条（取两者并集），结果按从上到下排序 */
export function mergeBandRects(existing: Rect[], incoming: Rect[], lineHeight: number): Rect[] {
	const tol = Math.max(lineHeight, MIN_LINE_HEIGHT) * SAME_LINE_FACTOR;
	const groups: Rect[][] = [];
	// 先从上到下扫，逐条并入第一个同基线的分组，分组内最后取并集
	for (const band of [...existing, ...incoming].sort((a, b) => b[3] - a[3] || a[0] - b[0])) {
		const group = groups.find((g) => Math.abs(bandMidY(g[0]) - bandMidY(band)) <= tol);
		if (group) group.push(band);
		else groups.push([band]);
	}
	return groups.map(unionRects).sort((a, b) => b[3] - a[3] || a[0] - b[0]);
}

/** 合并命中文本：按行去重，已有在前，新的追加在后（比较与输出都忽略首尾空白，空行丢弃） */
export function mergeHitText(existing: string, incoming: string): string {
	const seen = new Set<string>();
	const lines: string[] = [];
	for (const raw of [...existing.split('\n'), ...incoming.split('\n')]) {
		const line = raw.trim();
		if (line === '' || seen.has(line)) continue;
		seen.add(line);
		lines.push(line);
	}
	return lines.join('\n');
}
