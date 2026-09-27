import test from 'node:test';
import assert from 'node:assert/strict';
import {
	clampRect,
	fromNormalized,
	normalizeRect,
	parseRectParam,
	pdfToScreenPoint,
	pdfToScreenRect,
	rectParam,
	screenToPdfPoint,
	screenToPdfRect,
	toNormalized,
} from '../src/core/pdfgeom.ts';

test('矩形方向被整理成一顺', () => {
	assert.deepEqual(normalizeRect([300, 260, 100, 200]), [100, 200, 300, 260]);
});

test('矩形被限制在页面范围内', () => {
	assert.deepEqual(clampRect([-10, -20, 900, 900], [595, 842]), [0, 0, 595, 842]);
});

test('归一化往返一致', () => {
	const size: [number, number] = [600, 800];
	const rect: [number, number, number, number] = [60, 80, 300, 240];
	const norm = toNormalized(rect, size);
	assert.deepEqual(norm, [0.1, 0.1, 0.5, 0.3]);
	assert.deepEqual(fromNormalized(norm, size), rect);
	assert.deepEqual(
		fromNormalized(toNormalized(rect, size), [1200, 1600]),
		[120, 160, 600, 480],
	);
});

test('屏幕坐标转 PDF 坐标要翻转 y 轴', () => {
	const pdf = screenToPdfRect([100, 50, 300, 150], [600, 800], [600, 800]);
	assert.deepEqual(pdf, [100, 650, 300, 750]);
	assert.deepEqual(pdfToScreenRect(pdf, [600, 800], [600, 800]), [100, 50, 300, 150]);
});

test('缩放后的屏幕矩形换算回原始页面坐标', () => {
	const pdf = screenToPdfRect([50, 25, 150, 75], [300, 400], [600, 800]);
	assert.deepEqual(pdf, [100, 650, 300, 750]);
});

test('点的换算与矩形换算一致，且往返可逆', () => {
	const viewport: [number, number] = [300, 400];
	const page: [number, number] = [600, 800];
	const point = screenToPdfPoint({ x: 50, y: 25 }, viewport, page);
	assert.deepEqual(point, { x: 100, y: 750 });
	// 与矩形换算的角点一致
	const rect = screenToPdfRect([50, 25, 50, 25], viewport, page);
	assert.equal(rect[0], point.x);
	assert.equal(rect[1], point.y);
	// 换回屏幕坐标是同一个点
	const back = pdfToScreenPoint(point, viewport, page);
	assert.ok(Math.abs(back.x - 50) < 1e-9 && Math.abs(back.y - 25) < 1e-9);
});

test('矩形参数与 PDF++ 的 rect 参数互通', () => {
	assert.equal(rectParam([100.4, 200.6, 300.2, 260.9]), '100,201,300,261');
	assert.deepEqual(parseRectParam('100,200,300,260'), [100, 200, 300, 260]);
	assert.deepEqual(parseRectParam('300,260,100,200'), [100, 200, 300, 260]);
	assert.equal(parseRectParam('1,2,3'), null);
	assert.equal(parseRectParam('a,b,c,d'), null);
});
