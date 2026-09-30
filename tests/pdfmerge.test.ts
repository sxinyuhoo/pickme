import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeBandRects, mergeHitText, pickMergeTarget } from '../src/core/pdfmerge.ts';
import type { MergeTarget } from '../src/core/pdfmerge.ts';
import type { Rect } from '../src/core/pdfgeom.ts';

/** 行带：基线 base 字高 12 → [x0, base-3.6, x1, base+9.6] */
function band(x0: number, base: number, x1: number): Rect {
	return [x0, base - 3.6, x1, base + 9.6];
}

function target(id: string, page: number, bands: Rect[]): MergeTarget {
	return { id, page, bands };
}

/** 基线 200 的一条已有高亮，行带横向 [100, 220] */
const LINE200 = band(100, 200, 220);

test('pickMergeTarget：起笔点落在行带内 → 命中本行', () => {
	const targets = [target('a', 1, [LINE200])];
	assert.equal(pickMergeTarget(targets, 1, { x: 150, y: 200 }, 12), 'a');
});

test('pickMergeTarget：起笔点紧邻上一行（1.5 倍字高内）→ 命中', () => {
	const targets = [target('a', 1, [LINE200])];
	// 行带上沿 209.6，上一行起笔 y=220，距离 10.4 < 1.5*12
	assert.equal(pickMergeTarget(targets, 1, { x: 150, y: 220 }, 12), 'a');
});

test('pickMergeTarget：起笔点紧邻下一行（1.5 倍字高内）→ 命中', () => {
	const targets = [target('a', 1, [LINE200])];
	// 行带下沿 196.4，下一行起笔 y=185，距离 11.4 < 1.5*12
	assert.equal(pickMergeTarget(targets, 1, { x: 150, y: 185 }, 12), 'a');
});

test('pickMergeTarget：离得太远不命中', () => {
	const targets = [target('a', 1, [LINE200])];
	// 下沿 196.4-18=178.4、上沿 209.6+18=227.6 之外都算太远
	assert.equal(pickMergeTarget(targets, 1, { x: 150, y: 100 }, 12), null);
	assert.equal(pickMergeTarget(targets, 1, { x: 150, y: 300 }, 12), null);
});

test('pickMergeTarget：横向错开不命中', () => {
	const targets = [target('a', 1, [LINE200])];
	// 行带横向 [100, 220]，±1 之外都算错开
	assert.equal(pickMergeTarget(targets, 1, { x: 400, y: 200 }, 12), null);
	assert.equal(pickMergeTarget(targets, 1, { x: 50, y: 200 }, 12), null);
});

test('pickMergeTarget：不同页不命中', () => {
	const targets = [target('a', 2, [LINE200])];
	assert.equal(pickMergeTarget(targets, 1, { x: 150, y: 200 }, 12), null);
	assert.equal(pickMergeTarget(targets, 2, { x: 150, y: 200 }, 12), 'a');
});

test('pickMergeTarget：多条命中取纵向距离最近的一条', () => {
	const targets = [
		target('a', 1, [band(100, 200, 220)]), // 上沿 209.6
		target('b', 1, [band(100, 220, 220)]), // 下沿 216.4
	];
	// y=218 落在 b 的行带内（距离 0），离 a 上沿 8.4 → 取 b
	assert.equal(pickMergeTarget(targets, 1, { x: 150, y: 218 }, 12), 'b');
	// y=200 落在 a 的行带内（距离 0），离 b 下沿 16.4 → 取 a
	assert.equal(pickMergeTarget(targets, 1, { x: 150, y: 200 }, 12), 'a');
});

test('mergeBandRects：同一基线取并集，不同基线各留一条并按上到下排序', () => {
	const existing: Rect[] = [
		band(100, 300, 160), // 基线 300
		band(100, 200, 140), // 基线 200
	];
	const incoming: Rect[] = [
		band(140, 300, 200), // 与第一条同基线 → 并集 [100, 296.4, 200, 309.6]
	];
	assert.deepEqual(mergeBandRects(existing, incoming, 12), [
		[100, 296.4, 200, 309.6],
		[100, 196.4, 140, 209.6],
	]);
});

test('mergeBandRects：基线相差超过 0.6 倍字高不合并', () => {
	// 中点相距 10 > 0.6*12 = 7.2
	const merged = mergeBandRects([band(100, 200, 140)], [band(100, 210, 140)], 12);
	assert.equal(merged.length, 2);
});

test('mergeBandRects：只有新划行带时原样返回并排序', () => {
	assert.deepEqual(mergeBandRects([], [band(100, 200, 140), band(100, 300, 140)], 12), [
		[100, 296.4, 140, 309.6],
		[100, 196.4, 140, 209.6],
	]);
});

test('mergeHitText：已有在前、新的追加在后，按行去重', () => {
	assert.equal(mergeHitText('第一行\n第二行', '第二行\n第三行'), '第一行\n第二行\n第三行');
	assert.equal(mergeHitText('', '第三行'), '第三行');
	assert.equal(mergeHitText('第一行', ''), '第一行');
	assert.equal(mergeHitText('', ''), '');
});

test('mergeHitText：忽略首尾空白与空行', () => {
	assert.equal(mergeHitText('  第一行  \n\n  ', '第一行\n第二行'), '第一行\n第二行');
});
