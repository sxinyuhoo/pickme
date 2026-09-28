/** PDF 矩形坐标换算，纯函数 */

export type Rect = [number, number, number, number];
export type Size = [number, number];

/** 页面旋转角，只可能是 90 度的整数倍 */
export type PageRotation = 0 | 90 | 180 | 270;

/**
 * 把任意角度规整到 0/90/180/270，负数与超过 360 的值也收敛到正向。
 * pdf.js 的 page.rotate 历史上出现过负数与 360 的写法，这里一次收口，调用点不用管。
 */
function normRotation(rotation: number): PageRotation {
	const r = Math.round(rotation / 90) * 90;
	return (((r % 360) + 360) % 360) as PageRotation;
}

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
 *
 * viewportSize 是页面在屏幕上的 CSS 尺寸（已含旋转），pageSize 是**未旋转**的
 * PDF 用户空间尺寸（page.view 的宽高）；两者在旋转 90/270 时宽高互换，所以不能
 * 拿同一个尺寸当两边用。rotation 为 0 时走的仍是老公式，逐位一致（零回归）。
 */
export function screenToPdfRect(
	screen: Rect,
	viewportSize: Size,
	pageSize: Size,
	rotation: number = 0,
): Rect {
	const r = normalizeRect(screen);
	if (normRotation(rotation) === 0) {
		const [vw, vh] = viewportSize;
		const [pw, ph] = pageSize;
		const scaleX = pw / vw;
		const scaleY = ph / vh;
		// 屏幕 y 轴向下，PDF y 轴向上，需要翻转
		return [
			r[0] * scaleX,
			(ph - r[3] * scaleY),
			r[2] * scaleX,
			(ph - r[1] * scaleY),
		];
	}
	// 旋转页：90 度的整数倍旋转会把矩形转成矩形，映射两个对角点再整理即可
	const a = screenToPdfPoint({ x: r[0], y: r[1] }, viewportSize, pageSize, rotation);
	const b = screenToPdfPoint({ x: r[2], y: r[3] }, viewportSize, pageSize, rotation);
	return normalizeRect([a.x, a.y, b.x, b.y]);
}

/** PDF 用户空间矩形换算回屏幕坐标，用于在页面上绘制高亮 */
export function pdfToScreenRect(
	rect: Rect,
	viewportSize: Size,
	pageSize: Size,
	rotation: number = 0,
): Rect {
	const r = normalizeRect(rect);
	if (normRotation(rotation) === 0) {
		const [vw, vh] = viewportSize;
		const [pw, ph] = pageSize;
		const scaleX = vw / pw;
		const scaleY = vh / ph;
		return [r[0] * scaleX, (ph - r[3]) * scaleY, r[2] * scaleX, (ph - r[1]) * scaleY];
	}
	const a = pdfToScreenPoint({ x: r[0], y: r[1] }, viewportSize, pageSize, rotation);
	const b = pdfToScreenPoint({ x: r[2], y: r[3] }, viewportSize, pageSize, rotation);
	return normalizeRect([a.x, a.y, b.x, b.y]);
}

/**
 * 屏幕坐标点换算为 PDF 用户空间点。
 *
 * 旋转页按页面中心旋转映射：先把屏幕点归一化成 (u, v)（u 从左到右、v 从上到下），
 * 再用旋转角换回未旋转页面的归一化坐标 (p, q)（p 从左到右、q 从下到上），最后乘
 * 页面尺寸。四种角度下与 pdfToScreenPoint 互为精确逆运算。
 *
 * 约定的旋转方向是**屏幕上的页面相对 PDF 内容顺时针转了 rotation 度**：
 * 90 度时内容的上边转到屏幕右边，180 度时上下左右都反，270 度时内容的上边转到屏幕左边。
 */
export function screenToPdfPoint(
	point: { x: number; y: number },
	viewportSize: Size,
	pageSize: Size,
	rotation: number = 0,
): { x: number; y: number } {
	const rot = normRotation(rotation);
	const [vw, vh] = viewportSize;
	const [pw, ph] = pageSize;
	if (rot === 0) {
		return { x: point.x * (pw / vw), y: ph - point.y * (ph / vh) };
	}
	const u = point.x / vw;
	const v = point.y / vh;
	if (rot === 90) return { x: v * pw, y: u * ph };
	if (rot === 180) return { x: (1 - u) * pw, y: v * ph };
	return { x: (1 - v) * pw, y: (1 - u) * ph };
}

/** PDF 用户空间点换算回屏幕坐标 */
export function pdfToScreenPoint(
	point: { x: number; y: number },
	viewportSize: Size,
	pageSize: Size,
	rotation: number = 0,
): { x: number; y: number } {
	const rot = normRotation(rotation);
	const [vw, vh] = viewportSize;
	const [pw, ph] = pageSize;
	if (rot === 0) {
		return { x: point.x * (vw / pw), y: (ph - point.y) * (vh / ph) };
	}
	const p = point.x / pw;
	const q = point.y / ph;
	if (rot === 90) return { x: q * vw, y: p * vh };
	if (rot === 180) return { x: (1 - p) * vw, y: q * vh };
	return { x: (1 - q) * vw, y: (1 - p) * vh };
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
