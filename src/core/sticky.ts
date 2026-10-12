/** 便利贴图标几何，纯函数 */

import type { Rect } from './pdfgeom.ts';

/** 便利贴图标的默认边长，单位点；点哪儿以哪儿为中心铺一个正方形 */
export const NOTE_SIZE = 18;

/**
 * 点击点（page 坐标，y 轴向上）→ 便利贴图标的正方形矩形。
 * 以点击点为中心，并夹进页面内：整块图标不能探出 0..pageSize（靠边时整体向内平移）。
 */
export function noteRectAt(
	point: { x: number; y: number },
	pageSize: [number, number],
	size: number = NOTE_SIZE,
): Rect {
	const [w, h] = pageSize;
	const half = size / 2;
	let x0 = point.x - half;
	let y0 = point.y - half;
	let x1 = point.x + half;
	let y1 = point.y + half;
	// 越过左/下边界就整体右/上移回去，越过右/上边界再整体左/下移，保证正方形尺寸不变
	if (x0 < 0) {
		x1 -= x0;
		x0 = 0;
	}
	if (y0 < 0) {
		y1 -= y0;
		y0 = 0;
	}
	if (x1 > w) {
		x0 -= x1 - w;
		x1 = w;
	}
	if (y1 > h) {
		y0 -= y1 - h;
		y1 = h;
	}
	// 页面本身比图标还小时无解，最后再夹一层，至少不越界
	return [Math.max(0, x0), Math.max(0, y0), Math.min(w, x1), Math.min(h, y1)];
}
