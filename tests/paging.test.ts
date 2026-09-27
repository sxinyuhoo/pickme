import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SWIPE_FLIP_PX, decideWheel } from '../src/pdf/paging.ts';

test('纵向滚动一律不翻页、不吃事件（连续滚动下那是浏览文档本身）', () => {
	const r = decideWheel({ deltaX: 0, deltaY: 240, accum: 0, dir: 0 });
	assert.equal(r.flip, 0);
	assert.equal(r.consume, false, '不能吃掉，否则页面滚不动');
});

test('纵向滚动会把上一次的横向累积清掉，不会留着下次误翻', () => {
	const r = decideWheel({ deltaX: 0, deltaY: -60, accum: 100, dir: 1 });
	assert.equal(r.flip, 0);
	assert.equal(r.accum, 0);
	assert.equal(r.dir, 0);
});

test('斜着滑但纵向更大时，仍按纵向处理（不翻页）', () => {
	const r = decideWheel({ deltaX: 40, deltaY: 120, accum: 0, dir: 0 });
	assert.equal(r.flip, 0);
	assert.equal(r.consume, false);
});

test('横向小碎步累积到阈值才翻页，且一直吃掉事件', () => {
	let accum = 0;
	let dir = 0;
	for (const d of [40, 40]) {
		const r = decideWheel({ deltaX: d, deltaY: 2, accum, dir });
		accum = r.accum;
		dir = r.dir;
		assert.equal(r.flip, 0, '碎步不该翻页');
		assert.equal(r.consume, true, '横向手势要吃掉，否则会触发历史手势');
	}
	assert.equal(accum, 80);
	const last = decideWheel({ deltaX: 50, deltaY: 2, accum, dir });
	assert.equal(last.flip, 1, '累积到 130 > 阈值 120 应当翻下一页');
	assert.equal(last.accum, 0, '翻页后累积清零');
});

test('横向一次滑够距离直接翻页', () => {
	const r = decideWheel({ deltaX: 150, deltaY: 0, accum: 0, dir: 0 });
	assert.equal(r.flip, 1);
	assert.equal(r.consume, true);
});

test('横向反向滑动翻上一页', () => {
	const r = decideWheel({ deltaX: -150, deltaY: 3, accum: 0, dir: 0 });
	assert.equal(r.flip, -1);
});

test('方向一换就重新累积（不会拿反方向的旧累积凑数）', () => {
	const r = decideWheel({ deltaX: -100, deltaY: 1, accum: 110, dir: 1 });
	assert.equal(r.flip, 0, '换了方向应当从头累积，100 还不够');
	assert.equal(r.accum, -100);
	assert.equal(r.dir, -1);
});

test('零位移事件不改变任何状态', () => {
	const r = decideWheel({ deltaX: 0, deltaY: 0, accum: 40, dir: 1 });
	assert.equal(r.flip, 0);
	assert.equal(r.accum, 40);
	assert.equal(r.dir, 1);
	assert.equal(r.consume, false);
});

test('阈值是可解释的常量（约一次短促的横向滑动）', () => {
	assert.equal(SWIPE_FLIP_PX, 120);
});
