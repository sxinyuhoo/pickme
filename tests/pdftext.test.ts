import test from 'node:test';
import assert from 'node:assert/strict';
import {
	dragRect,
	hasMinimumSize,
	itemBox,
	itemsInRect,
	joinItemText,
	textInRect,
} from '../src/core/pdftext.ts';

function box(str: string, x: number, y: number, width = 20, height = 10) {
	return { str, x, y, width, height };
}

/** TextItemBox 还原成 pdf.js 形状，给按矩形取文字的函数用 */
function rawOf(items: { str: string; x: number; y: number; width: number; height: number }[]) {
	return items.map((item) => ({
		str: item.str,
		transform: [item.height, 0, 0, item.height, item.x, item.y],
		width: item.width,
		height: item.height,
	}));
}

test('拖拽方向不影响矩形', () => {
	assert.deepEqual(dragRect({ x: 100, y: 80 }, { x: 20, y: 10 }), [20, 10, 100, 80]);
});

test('太小的框选被拒绝', () => {
	assert.equal(hasMinimumSize([0, 0, 20, 20], 8), true);
	assert.equal(hasMinimumSize([0, 0, 5, 20], 8), false);
});

test('只取落在选区里的文字项，并按阅读顺序排序', () => {
	const items = [
		box('第二行左', 20, 60),
		box('第一行右', 60, 80),
		box('第一行左', 20, 80),
		box('框外', 200, 300),
	];
	const picked = itemsInRect(items, [10, 50, 120, 95]);
	assert.deepEqual(
		picked.map((item) => item.str),
		['第一行左', '第一行右', '第二行左'],
	);
});

test('同一行的文字按间距补空格，不同行换行', () => {
	const items = [
		box('最大纵坡', 20, 80, 40),
		box('不应大于', 62, 80, 40),
		box('3%', 20, 60, 10),
	];
	assert.equal(joinItemText(items), '最大纵坡不应大于\n3%');
});

test('间距大的同行文字之间补空格', () => {
	const items = [box('Table', 20, 80, 30), box('3', 90, 80, 6)];
	assert.equal(joinItemText(items), 'Table 3');
});

test('从 pdf.js 原始项到文本的完整链路', () => {
	const raw = [
		{ str: '规范要求', transform: [12, 0, 0, 12, 30, 200], width: 48, height: 12 },
		{ str: '最大纵坡 3%', transform: [12, 0, 0, 12, 30, 180], width: 70, height: 12 },
		{ str: '无关内容', transform: [12, 0, 0, 12, 400, 500], width: 48, height: 12 },
	];
	assert.equal(textInRect(raw, [20, 170, 200, 215]), '规范要求\n最大纵坡 3%');
	assert.equal(textInRect(raw, [390, 490, 500, 520]), '无关内容');
	assert.equal(textInRect(raw, [300, 300, 350, 350]), '');
});

test('框选只取框内的文字，不跨栏（双栏页面框右栏）', () => {
	// 真机场景：docker cheatsheet 第 1 页，左栏一行 x=36 宽 233.5，右栏同一行 x=319.5 宽 83，中缝 50pt
	const items = [
		box('Docker Desktop is available for Mac, Linux and Windows', 36, 495, 233.5, 8),
		box('Start the docker daemon', 319.5, 495, 83, 8),
	];
	const raw = rawOf(items);
	// 框住右栏那一项
	assert.equal(textInRect(raw, [316, 490, 406, 508]), 'Start the docker daemon');
	// 框住左栏那一项
	assert.equal(
		textInRect(raw, [32, 490, 273, 508]),
		'Docker Desktop is available for Mac, Linux and Windows',
	);
});

test('原始项的变换矩阵被正确读取', () => {
	assert.deepEqual(itemBox({ str: 'x', transform: [1, 0, 0, 1, 42, 84], width: 5, height: 6 }), {
		str: 'x',
		x: 42,
		y: 84,
		width: 5,
		height: 6,
	});
});
