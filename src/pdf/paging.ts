/**
 * 触控板手势翻页的判定逻辑（纯函数，便于单测）。
 *
 * 连续滚动之后，纵向滚轮就是浏览文档本身，只有**横向滑动**才是「整页跳」的手势：
 * |deltaX| > |deltaY| 才算手势，累积到阈值才翻页（避免手一抖就跳页），方向一换重新累积。
 */

/** 横向累积多少像素算一次整页跳 */
export const SWIPE_FLIP_PX = 120;

export interface WheelInput {
	deltaX: number;
	deltaY: number;
	/** 上一次累积的方向与距离 */
	accum: number;
	dir: number;
}

export interface WheelDecision {
	/** 1 = 下一页，-1 = 上一页，0 = 不翻页 */
	flip: 0 | 1 | -1;
	/** 累积状态，调用方存回 */
	accum: number;
	dir: number;
	/** 是否吃掉这次事件（横向手势要吃掉，否则会触发历史手势或横向滚动） */
	consume: boolean;
}

export function decideWheel(input: WheelInput): WheelDecision {
	const horizontal = Math.abs(input.deltaX) > Math.abs(input.deltaY);
	const delta = horizontal ? input.deltaX : input.deltaY;
	if (!delta) return { flip: 0, accum: input.accum, dir: input.dir, consume: false };
	if (!horizontal) return { flip: 0, accum: 0, dir: 0, consume: false };
	const dir = delta > 0 ? 1 : -1;
	const accum = dir === input.dir ? input.accum + delta : delta;
	if (Math.abs(accum) < SWIPE_FLIP_PX) return { flip: 0, accum, dir, consume: true };
	return { flip: dir === 1 ? 1 : -1, accum: 0, dir, consume: true };
}
