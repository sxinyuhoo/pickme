import assert from 'node:assert/strict';
import { test } from 'node:test';
import { flattenOutline } from '../src/pdf/outline.ts';

/** 简单版：把 dest 当作页码字符串，用来验证结构 */
const pageOf = (pages: Record<string, number>) => (item: { title?: string }) =>
	pages[item.title ?? ''] ?? null;

test('按层级摊平，顺序与缩进都跟着树走', () => {
	const entries = flattenOutline(
		[
			{ title: '第一章', dest: '第一章' },
			{ title: '第二章', dest: '第二章', items: [{ title: '2.1', dest: '2.1' }, { title: '2.2', dest: '2.2' }] },
			{ title: '第三章', dest: '第三章' },
		],
		pageOf({ 第一章: 1, 第二章: 5, '2.1': 5, '2.2': 8, 第三章: 12 }),
	);
	assert.deepEqual(entries, [
		{ title: '第一章', depth: 0, page: 1 },
		{ title: '第二章', depth: 0, page: 5 },
		{ title: '2.1', depth: 1, page: 5 },
		{ title: '2.2', depth: 1, page: 8 },
		{ title: '第三章', depth: 0, page: 12 },
	]);
});

test('多级嵌套的层级数字逐级加一', () => {
	const entries = flattenOutline(
		[{ title: 'A', items: [{ title: 'A.1', items: [{ title: 'A.1.1' }, { title: 'A.1.2' }] }] }],
		() => 3,
	);
	assert.deepEqual(entries.map((e) => [e.title, e.depth]), [
		['A', 0],
		['A.1', 1],
		['A.1.1', 2],
		['A.1.2', 2],
	]);
});

test('解析不出页码的条目保留，标成 null（点了不跳）', () => {
	const entries = flattenOutline([{ title: '没有目标' }, { title: '有目标', dest: 'x' }], pageOf({ 有目标: 7 }));
	assert.deepEqual(entries, [
		{ title: '没有目标', depth: 0, page: null },
		{ title: '有目标', depth: 0, page: 7 },
	]);
});

test('空标题的分组节点自己不显示，子项照常展开', () => {
	const entries = flattenOutline([{ title: '   ', items: [{ title: '子项', dest: '子项' }] }], pageOf({ 子项: 2 }));
	assert.deepEqual(entries, [{ title: '子项', depth: 1, page: 2 }]);
});

test('空目录得到空数组', () => {
	assert.deepEqual(flattenOutline([], () => 1), []);
});
