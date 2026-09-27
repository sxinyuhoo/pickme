/** PDF 矩形坐标换算，纯函数 */

export type Rect = [number, number, number, number];
export type Size = [number, number];

/** 把任意方向的矩形整理成 x1<=x2 且 y1<=y2 */
export function normalizeRect(rect: Rect): Rect {
	const [x1, y1, x2, y2] = rect;
	return [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)];
}

/** 限制在页面范围内 */
export function clampRect(rect: Rect, size: Size): Rect {
	const [w, h] = size;
	const r = normalizeRect(rect);
	return [Math.max(0, r[0]), Math.max(0, r[1]), Math.min(w, r[2]), Math.min(h, r[3])];
}

/** 换算为 0 到 1 的归一化矩形，用于跨缩放回显 */
export function toNormalized(rect: Rect, size: Size): Rect {
	const [w, h] = size;
	const r = normalizeRect(rect);
	return [r[0] / w, r[1] / h, r[2] / w, r[3] / h];
}

/** 归一化矩形还原为页面坐标 */
export function fromNormalized(norm: Rect, size: Size): Rect {
	const [w, h] = size;
	return [norm[0] * w, norm[1] * h, norm[2] * w, norm[3] * h];
}

/**
 * 屏幕坐标换算为 PDF 用户空间坐标（左下为原点）。
 * 输入是页面 canvas 上的 CSS 像素矩形，viewport 提供尺寸与缩放比。
 */
export function screenToPdfRect(
	screen: Rect,
	viewportSize: Size,
	pageSize: Size,
): Rect {
	const [vw, vh] = viewportSize;
	const [pw, ph] = pageSize;
	const scaleX = pw / vw;
	const scaleY = ph / vh;
	const r = normalizeRect(screen);
	// 屏幕 y 轴向下，PDF y 轴向上，需要翻转
	return [
		r[0] * scaleX,
		(ph - r[3] * scaleY),
		r[2] * scaleX,
		(ph - r[1] * scaleY),
	];
}

/** PDF 用户空间矩形换算回屏幕坐标，用于在页面上绘制高亮 */
export function pdfToScreenRect(rect: Rect, viewportSize: Size, pageSize: Size): Rect {
	const [vw, vh] = viewportSize;
	const [pw, ph] = pageSize;
	const scaleX = vw / pw;
	const scaleY = vh / ph;
	const r = normalizeRect(rect);
	return [r[0] * scaleX, (ph - r[3]) * scaleY, r[2] * scaleX, (ph - r[1]) * scaleY];
}

/** 屏幕坐标点换算为 PDF 用户空间点 */
export function screenToPdfPoint(
	point: { x: number; y: number },
	viewportSize: Size,
	pageSize: Size,
): { x: number; y: number } {
	const [vw, vh] = viewportSize;
	const [pw, ph] = pageSize;
	return { x: point.x * (pw / vw), y: ph - point.y * (ph / vh) };
}

/** PDF 用户空间点换算回屏幕坐标 */
export function pdfToScreenPoint(
	point: { x: number; y: number },
	viewportSize: Size,
	pageSize: Size,
): { x: number; y: number } {
	const [vw, vh] = viewportSize;
	const [pw, ph] = pageSize;
	return { x: point.x * (vw / pw), y: (ph - point.y) * (vh / ph) };
}

/** 与 PDF++ 的 &rect= 链接参数一致的字符串形式 */
export function rectParam(rect: Rect): string {
	const r = normalizeRect(rect).map((n) => Math.round(n));
	return r.join(',');
}

export function parseRectParam(value: string): Rect | null {
	const parts = value.split(',').map((n) => Number(n.trim()));
	if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return null;
	return normalizeRect([parts[0], parts[1], parts[2], parts[3]]);
}
