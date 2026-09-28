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

/* ---------- 旋转页（rotation 0/90/180/270） ---------- */

/**
 * 屏幕尺寸：旋转 90/270 时，未旋转页面的宽高在屏幕上互换。
 * pageSize 是未旋转的 PDF 用户空间尺寸（page.view 的宽高），viewportSize 是屏幕上看到的 CSS 尺寸。
 */
function viewportFor(page: [number, number], rotation: number): [number, number] {
	return rotation === 90 || rotation === 270 ? [page[1], page[0]] : [page[0], page[1]];
}

function close(actual: number, expected: number, label: string) {
	assert.ok(Math.abs(actual - expected) < 1e-6, `${label} 期望 ${expected}，实际 ${actual}`);
}

test('旋转页的点：屏幕 → 用户空间 → 屏幕，四种角度都精确往返', () => {
	const page: [number, number] = [595, 842];
	const samples: [number, number][] = [[0, 0], [7.5, 13.25], [120.5, 300.25], [594, 500]];
	for (const rotation of [0, 90, 180, 270]) {
		const viewport = viewportFor(page, rotation);
		for (const [x, y] of samples) {
			const pdf = screenToPdfPoint({ x, y }, viewport, page, rotation);
			const back = pdfToScreenPoint(pdf, viewport, page, rotation);
			close(back.x, x, `rotation=${rotation} 点(${x},${y}) 往返后的 x`);
			close(back.y, y, `rotation=${rotation} 点(${x},${y}) 往返后的 y`);
			// 换算结果必须落在未旋转页面的范围内，否则说明尺寸用错了（把旋转后的宽高当成页面宽高）
			assert.ok(
				pdf.x >= -1e-6 && pdf.x <= page[0] + 1e-6 && pdf.y >= -1e-6 && pdf.y <= page[1] + 1e-6,
				`rotation=${rotation} 点(${x},${y}) 换算后跑出页面：(${pdf.x},${pdf.y})`,
			);
		}
	}
});

test('旋转页的矩形：屏幕 → 用户空间 → 屏幕，四种角度都精确往返', () => {
	const page: [number, number] = [600, 800];
	const screen: [number, number, number, number] = [50, 25, 210, 175];
	for (const rotation of [0, 90, 180, 270]) {
		const viewport = viewportFor(page, rotation);
		const pdf = screenToPdfRect(screen, viewport, page, rotation);
		const back = pdfToScreenRect(pdf, viewport, page, rotation);
		for (let i = 0; i < 4; i++) close(back[i], screen[i], `rotation=${rotation} 往返后第 ${i} 个角`);
		assert.ok(pdf[0] >= 0 && pdf[1] >= 0 && pdf[2] <= page[0] && pdf[3] <= page[1]);
	}
});

test('rotation 传 0 或不传，结果与老公式逐位一致（零回归）', () => {
	const viewport: [number, number] = [300, 400];
	const page: [number, number] = [600, 800];
	const screen: [number, number, number, number] = [50, 25, 150, 75];
	const pdf: [number, number, number, number] = [100, 650, 300, 750];
	// 老公式的期望值：x 乘 2，y 由 800 减去
	assert.deepEqual(screenToPdfRect(screen, viewport, page), [100, 650, 300, 750]);
	assert.deepEqual(screenToPdfRect(screen, viewport, page, 0), screenToPdfRect(screen, viewport, page));
	assert.deepEqual(pdfToScreenRect(pdf, viewport, page, 0), pdfToScreenRect(pdf, viewport, page));
	assert.deepEqual(
		screenToPdfPoint({ x: 50, y: 25 }, viewport, page, 0),
		screenToPdfPoint({ x: 50, y: 25 }, viewport, page),
	);
	assert.deepEqual(
		pdfToScreenPoint({ x: 100, y: 750 }, viewport, page, 0),
		pdfToScreenPoint({ x: 100, y: 750 }, viewport, page),
	);
	// 角度先归一化再判定：360 就是 0
	assert.deepEqual(
		screenToPdfRect(screen, viewport, page, 360),
		screenToPdfRect(screen, viewport, page),
	);
});

test('已知值：旋转 90 度，屏幕右上角是页面左上角', () => {
	// 页面 600x800（未旋转），转 90 度后屏幕上的尺寸是 800x600。
	// 内容整体顺时针转 90 度：内容的上边贴到屏幕右边，内容的左边贴到屏幕上边。
	// 屏幕点 (200, 150)：u = 200/800 = 0.25（离屏幕左边 1/4），v = 150/600 = 0.25（离屏幕上边 1/4）。
	// 「屏幕左边→内容下边」给 q = u = 0.25 → y = 0.25 * 800 = 200；
	// 「屏幕上边→内容左边」给 p = v = 0.25 → x = 0.25 * 600 = 150。
	assert.deepEqual(screenToPdfPoint({ x: 200, y: 150 }, [800, 600], [600, 800], 90), {
		x: 150,
		y: 200,
	});
	// 反向按 p = x/pw、q = y/ph 还原：x = q * vw = 0.25 * 800 = 200，y = p * vh = 0.25 * 600 = 150
	assert.deepEqual(pdfToScreenPoint({ x: 150, y: 200 }, [800, 600], [600, 800], 90), {
		x: 200,
		y: 150,
	});
	// 内容左上角 (0, 800) 在屏幕上落到右上角 (800, 0)
	const topLeft = pdfToScreenPoint({ x: 0, y: 800 }, [800, 600], [600, 800], 90);
	assert.deepEqual(topLeft, { x: 800, y: 0 });
	// 整块屏幕对应整张页面，四个角都不会漏
	assert.deepEqual(screenToPdfRect([0, 0, 800, 600], [800, 600], [600, 800], 90), [0, 0, 600, 800]);
});

test('已知值：旋转 180 度，绕页面中心做点对称', () => {
	// 180 度等价于把老公式（未旋转）算出的点绕中心 (300, 400) 做点对称。
	// 屏幕点 (150, 200) 按老公式是页面 (150, 800 - 200) = (150, 600)；
	// 对中心对称：(600 - 150, 800 - 600) = (450, 200)。
	assert.deepEqual(screenToPdfPoint({ x: 150, y: 200 }, [600, 800], [600, 800], 180), {
		x: 450,
		y: 200,
	});
	// 反向：x = (1 - 450/600) * 600 = 150，y = (200/800) * 800 = 200
	assert.deepEqual(pdfToScreenPoint({ x: 450, y: 200 }, [600, 800], [600, 800], 180), {
		x: 150,
		y: 200,
	});
	// 内容左上角 (0, 800) 落到屏幕右下角 (600, 800)
	assert.deepEqual(pdfToScreenPoint({ x: 0, y: 800 }, [600, 800], [600, 800], 180), {
		x: 600,
		y: 800,
	});
});

test('已知值：旋转 270 度（逆时针 90 度）', () => {
	// 页面 600x800 转 270 度后屏幕尺寸 800x600。
	// 逆时针 90 度：内容的上边贴到屏幕左边、内容的右边贴到屏幕上边。
	// 屏幕点 (200, 150)：离屏幕上边 1/4 → 离内容右边 1/4 → p = 1 - 0.25 = 0.75 → x = 0.75 * 600 = 450；
	// 离屏幕左边 1/4 → 离内容下边 1/4 → q = 1 - 0.25 = 0.75 → y = 0.75 * 800 = 600。
	assert.deepEqual(screenToPdfPoint({ x: 200, y: 150 }, [800, 600], [600, 800], 270), {
		x: 450,
		y: 600,
	});
	// 反向：x = (1 - 600/800) * 800 = 200，y = (1 - 450/600) * 600 = 150
	assert.deepEqual(pdfToScreenPoint({ x: 450, y: 600 }, [800, 600], [600, 800], 270), {
		x: 200,
		y: 150,
	});
	// 内容左上角 (0, 800) 落到屏幕左下角 (0, 600)
	assert.deepEqual(pdfToScreenPoint({ x: 0, y: 800 }, [800, 600], [600, 800], 270), {
		x: 0,
		y: 600,
	});
	// -90 与 270 是同一个角度（pdf.js 历史上有负数写法）
	assert.deepEqual(
		screenToPdfPoint({ x: 200, y: 150 }, [800, 600], [600, 800], -90),
		screenToPdfPoint({ x: 200, y: 150 }, [800, 600], [600, 800], 270),
	);
});

test('四种角度下整块屏幕都对应整张页面', () => {
	const page: [number, number] = [600, 800];
	for (const rotation of [0, 90, 180, 270]) {
		const viewport = viewportFor(page, rotation);
		assert.deepEqual(
			screenToPdfRect([0, 0, viewport[0], viewport[1]], viewport, page, rotation),
			[0, 0, 600, 800],
		);
	}
});
