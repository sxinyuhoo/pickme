import test from 'node:test';
import assert from 'node:assert/strict';
import { NOTE_SIZE, noteRectAt } from '../src/core/sticky.ts';

const PAGE: [number, number] = [595, 842];

test('点击点在页面中间：以点击点为中心铺一个正方形', () => {
	const rect = noteRectAt({ x: 300, y: 400 }, PAGE);
	assert.equal(rect[2] - rect[0], NOTE_SIZE, '宽等于图标边长');
	assert.equal(rect[3] - rect[1], NOTE_SIZE, '高等于图标边长');
	assert.equal(rect[0], 300 - NOTE_SIZE / 2);
	assert.equal(rect[1], 400 - NOTE_SIZE / 2);
	assert.equal(rect[2], 300 + NOTE_SIZE / 2);
	assert.equal(rect[3], 400 + NOTE_SIZE / 2);
});

test('点靠左/下边：整块图标夹回页面内，尺寸不变', () => {
	const rect = noteRectAt({ x: 2, y: 3 }, PAGE);
	assert.deepEqual(rect, [0, 0, NOTE_SIZE, NOTE_SIZE]);
	assert.equal(rect[2] - rect[0], NOTE_SIZE);
});

test('点靠右/上边：整块图标夹回页面内，尺寸不变', () => {
	const rect = noteRectAt({ x: PAGE[0] - 1, y: PAGE[1] - 2 }, PAGE);
	assert.deepEqual(rect, [PAGE[0] - NOTE_SIZE, PAGE[1] - NOTE_SIZE, PAGE[0], PAGE[1]]);
});

test('四个角点：只留页面内的那一块，不越界', () => {
	assert.deepEqual(noteRectAt({ x: 0, y: 0 }, PAGE), [0, 0, NOTE_SIZE, NOTE_SIZE]);
	assert.deepEqual(noteRectAt({ x: PAGE[0], y: 0 }, PAGE), [
		PAGE[0] - NOTE_SIZE,
		0,
		PAGE[0],
		NOTE_SIZE,
	]);
	assert.deepEqual(noteRectAt({ x: 0, y: PAGE[1] }, PAGE), [
		0,
		PAGE[1] - NOTE_SIZE,
		NOTE_SIZE,
		PAGE[1],
	]);
	assert.deepEqual(noteRectAt({ x: PAGE[0], y: PAGE[1] }, PAGE), [
		PAGE[0] - NOTE_SIZE,
		PAGE[1] - NOTE_SIZE,
		PAGE[0],
		PAGE[1],
	]);
});

test('size 可传：自定义边长仍以点击点为中心', () => {
	assert.deepEqual(noteRectAt({ x: 300, y: 400 }, PAGE, 40), [280, 380, 320, 420]);
	// 小页面下图标比页面还大：无解，但至少不越界
	const tight = noteRectAt({ x: 5, y: 5 }, [10, 10], 40);
	assert.ok(tight[0] >= 0 && tight[1] >= 0 && tight[2] <= 10 && tight[3] <= 10);
	assert.ok(tight[0] <= tight[2] && tight[1] <= tight[3]);
});

test('无论点在哪（含页面外），矩形都落在页面内', () => {
	const points = [
		{ x: -50, y: -50 },
		{ x: 0, y: 421 },
		{ x: 297, y: 0 },
		{ x: 9999, y: 9999 },
	];
	for (const point of points) {
		const r = noteRectAt(point, PAGE);
		assert.ok(
			r[0] >= 0 && r[1] >= 0 && r[2] <= PAGE[0] && r[3] <= PAGE[1],
			`越界：${JSON.stringify(r)}`,
		);
		assert.ok(r[0] <= r[2] && r[1] <= r[3], `方向错：${JSON.stringify(r)}`);
	}
});
