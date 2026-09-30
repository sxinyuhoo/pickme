import test from 'node:test';
import assert from 'node:assert/strict';
import {
	dragRect,
	hasMinimumSize,
	itemBox,
	itemsInRect,
	joinItemText,
	linesText,
	strokeToLines,
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

/* ---------- 荧光笔吸附（strokeToLines / linesText） ---------- */

/** 把 [x, y] 点列写成笔迹采样点，坐标是 PDF 用户空间 */
function stroke(list: [number, number][]) {
	return list.map(([x, y]) => ({ x, y }));
}

function close(actual: number, expected: number, label: string) {
	assert.ok(Math.abs(actual - expected) < 1e-6, `${label} 期望 ${expected}，实际 ${actual}`);
}

test('荧光笔单行直划：吸出一个行框，边界等于该行文字项边界', () => {
	const items = [box('最大纵坡不应大于 3%', 100, 200, 120, 12)];
	const lines = strokeToLines(items, stroke([[100, 202], [220, 202]]));
	assert.equal(lines.length, 1);
	assert.equal(lines[0].items.length, 1);
	assert.equal(lines[0].items[0].str, '最大纵坡不应大于 3%');
	// 行带纵向 = [y - 0.3h, y + 0.8h] = [200 - 3.6, 200 + 9.6]；横向 = 命中项边界 100 到 220
	close(lines[0].rect[0], 100, '左边界');
	close(lines[0].rect[1], 196.4, '下边界');
	close(lines[0].rect[2], 220, '右边界');
	close(lines[0].rect[3], 209.6, '上边界');
	assert.equal(linesText(lines), '最大纵坡不应大于 3%');
});

test('荧光笔斜划跨 3 行：3 个行框，按上到下排序', () => {
	const items = [
		box('第一行文字', 100, 300, 80, 12),
		box('第二行文字', 100, 280, 80, 12),
		box('第三行文字', 100, 260, 80, 12),
	];
	// 斜线从 y=305 降到 y=265，横坐标 110→170，全程落在文字项的 x 范围内
	const lines = strokeToLines(items, stroke([[110, 305], [170, 265]]));
	assert.deepEqual(
		lines.map((line) => line.items[0].str),
		['第一行文字', '第二行文字', '第三行文字'],
	);
	assert.equal(linesText(lines), '第一行文字\n第二行文字\n第三行文字');
});

test('荧光笔竖划整段：段落每一行都命中', () => {
	const items = [
		box('第一行', 100, 300, 80, 12),
		box('第二行', 100, 280, 80, 12),
		box('第三行', 100, 260, 80, 12),
		box('第四行', 100, 240, 80, 12),
	];
	// 竖线横坐标 130 落在每一项的 x 范围内，纵向从 310 划到 230
	const lines = strokeToLines(items, stroke([[130, 310], [130, 230]]));
	assert.equal(lines.length, 4);
	assert.deepEqual(
		lines.map((line) => line.items[0].str),
		['第一行', '第二行', '第三行', '第四行'],
	);
});

test('荧光笔跨双栏：每栏各自成框，不横跨中缝', () => {
	// 真机场景：双栏论文同一基线，左栏一项 x=36 宽 233.5，右栏一项 x=319.5 宽 83，中缝 50pt
	const items = [
		box('Docker Desktop is available for Mac, Linux and Windows', 36, 495, 233.5, 8),
		box('Start the docker daemon', 319.5, 495, 83, 8),
	];
	const lines = strokeToLines(items, stroke([[60, 508], [380, 494]]));
	assert.deepEqual(
		lines.map((line) => line.items[0].str),
		['Docker Desktop is available for Mac, Linux and Windows', 'Start the docker daemon'],
	);
	// 左栏框的右边界是左栏文字项自身的右边界 36 + 233.5，没有伸到中缝里
	close(lines[0].rect[2], 269.5, '左栏右边界');
	close(lines[1].rect[0], 319.5, '右栏左边界');
});

test('上下标基线偏移小于容差：不误分成两行', () => {
	// E 的基线 80 高 10，上标 2 的基线 83 高 7，偏移 3 < max(10,7,4)*0.6 = 6
	const items = [box('E', 20, 80, 10, 10), box('2', 30, 83, 5, 7)];
	const lines = strokeToLines(items, stroke([[20, 82], [40, 82]]));
	assert.equal(lines.length, 1);
	assert.equal(lines[0].items.length, 2);
	// 两行的话 linesText 会带换行；同一行内间距为 0，不补空格
	assert.equal(linesText(lines), 'E2');
});

test('横向只覆盖半行：右边界吸到笔迹覆盖处，不吸整行', () => {
	const items = [
		box('最大纵坡', 20, 80, 40, 10),
		box('不应大于', 62, 80, 40, 10),
		box('3%', 104, 80, 12, 10),
	];
	// 划到 x=78 就收笔，最后一项「3%」起点 104，没被碰过
	const lines = strokeToLines(items, stroke([[20, 82], [78, 82]]));
	assert.equal(lines.length, 1);
	assert.deepEqual(
		lines[0].items.map((item) => item.str),
		['最大纵坡', '不应大于'],
	);
	close(lines[0].rect[0], 20, '左边界');
	// 笔迹划到 78 收笔：右边界吸到笔迹覆盖处 78 + 1pt 容差，
	// 命中项右边界 102、整行右边界 116 都没被铺满
	close(lines[0].rect[2], 79, '右边界');
});

test('横向划多少算多少：笔迹只覆盖单个文字项中间一小段', () => {
	// 一行就是一个长 item，笔迹只压中间一小段，行带不铺满整项
	const items = [box('最大纵坡不应大于 3%', 100, 200, 200, 12)];
	const lines = strokeToLines(items, stroke([[160, 202], [200, 202]]));
	assert.equal(lines.length, 1);
	// 起止就是笔迹覆盖的左右端点（各留 1pt 容差），远窄于文字项 [100, 300]
	close(lines[0].rect[0], 159, '左边界');
	close(lines[0].rect[2], 201, '右边界');
	assert.ok(lines[0].rect[2] - lines[0].rect[0] < 200, '行带应明显窄于文字项');
	assert.equal(linesText(lines), '最大纵坡不应大于 3%');
});

test('横向划满整项并超出两端：行带等于文字项范围，超出被夹住', () => {
	const items = [box('最大纵坡不应大于 3%', 100, 200, 120, 12)];
	// 起点在项左端之外，终点在右端之外
	const lines = strokeToLines(items, stroke([[40, 202], [320, 202]]));
	assert.equal(lines.length, 1);
	close(lines[0].rect[0], 100, '左边界夹到项左端');
	close(lines[0].rect[2], 220, '右边界夹到项右端');
});

test('同一行两个文字项：笔迹只压到其中一个的一部分', () => {
	const items = [
		box('前半句', 20, 80, 40, 10), // 范围 [20, 60]
		box('后半句', 62, 80, 40, 10), // 范围 [62, 102]
	];
	// 笔迹只在第二个项中段落笔，完全没碰到第一个项
	const lines = strokeToLines(items, stroke([[72, 82], [92, 82]]));
	assert.equal(lines.length, 1);
	assert.deepEqual(
		lines[0].items.map((item) => item.str),
		['后半句'],
	);
	// 行带只覆盖笔迹落点：既不含未命中的「前半句」，也没铺满整个「后半句」
	close(lines[0].rect[0], 71, '左边界');
	close(lines[0].rect[2], 93, '右边界');
	assert.ok(lines[0].rect[0] > 62, '行带左端应落在第二个项内部');
	assert.ok(lines[0].rect[2] < 102, '行带右端不该铺满整个项');
});

test('笔迹划在文字项之外的部分不能把行带拉长', () => {
	// 右邻项与左项间距远超断开阈值（140 > 30），属于另一段
	const items = [
		box('最大纵坡', 100, 200, 60, 12), // [100, 160]
		box('不应大于', 300, 200, 60, 12), // [300, 360]
	];
	// 笔迹右段划到 x=190，已经超出左项右端 160
	const lines = strokeToLines(items, stroke([[150, 202], [190, 202]]));
	assert.equal(lines.length, 1);
	assert.deepEqual(
		lines[0].items.map((item) => item.str),
		['最大纵坡'],
	);
	// 超出左项的部分被夹住，行带右端停在 160，没被拖到 x=360
	close(lines[0].rect[0], 149, '左边界');
	close(lines[0].rect[2], 160, '右边界夹到项右端');
});

test('空白处划线返回空数组', () => {
	const items = [box('正文', 20, 300, 40, 12), box('   ', 20, 200, 40, 12)];
	assert.deepEqual(strokeToLines(items, stroke([[300, 100], [360, 100]])), []);
	// 行与行之间的空白：纵向不落进任何行带
	assert.deepEqual(strokeToLines(items, stroke([[20, 290], [60, 290]])), []);
	// 连页码都没有的扫描件（无文字项）
	assert.deepEqual(strokeToLines([], stroke([[300, 100], [360, 100]])), []);
});

test('单点（单击）返回空数组', () => {
	const items = [box('正文', 20, 300, 40, 12)];
	assert.deepEqual(strokeToLines(items, stroke([[30, 302]])), []);
	assert.deepEqual(strokeToLines(items, []), []);
	// 短到只剩手抖的一段（总长 6，首尾各丢 4）也作废
	assert.deepEqual(strokeToLines(items, stroke([[30, 302], [36, 302]])), []);
});

test('快速拖动（相邻采样点间距很大）：补齐采样后不漏行', () => {
	const items = [
		box('第一行', 100, 300, 120, 12),
		box('第二行', 100, 280, 120, 12),
		box('第三行', 100, 260, 120, 12),
	];
	// pointermove 只报了首尾两点，中间 200pt 一点采样都没有；
	// 两个端点还都在文字项的 x 范围（100~220）之外，命中只能来自线段与行带相交。
	const lines = strokeToLines(items, stroke([[60, 320], [260, 240]]));
	assert.deepEqual(
		lines.map((line) => line.items[0].str),
		['第一行', '第二行', '第三行'],
	);
});

test('吸附结果按先上后下、再左到右排序', () => {
	// 同一基线两项分属左右栏，跨中缝划线后应当先出左栏
	const items = [
		box('右栏', 320, 400, 40, 10),
		box('左栏', 40, 400, 40, 10),
		box('下一行', 40, 380, 40, 10),
	];
	// 一笔先横跨两栏，再折回左下角划到下一行
	const lines = strokeToLines(items, stroke([[40, 398], [355, 398], [40, 382], [80, 382]]));
	assert.deepEqual(
		lines.map((line) => line.items[0].str),
		['左栏', '右栏', '下一行'],
	);
});

/* ---------- 竖向为主的一笔 = 整行 ---------- */

test('荧光笔竖划跨 3 行：每行铺满该行文字，不再是几 pt 的细条', () => {
	const items = [
		box('第一行文字', 100, 300, 80, 12),
		box('第二行文字', 100, 280, 80, 12),
		box('第三行文字', 100, 260, 80, 12),
	];
	// 竖线横坐标 130 落在三项之内，纵向从 310 划到 250，跨过 3 行的行带
	const lines = strokeToLines(items, stroke([[130, 310], [130, 250]]));
	assert.deepEqual(
		lines.map((line) => line.items[0].str),
		['第一行文字', '第二行文字', '第三行文字'],
	);
	// 每行横向都铺满命中项范围 [100, 180]，而不是 4pt 细条
	for (const line of lines) {
		close(line.rect[0], 100, `${line.items[0].str} 左边界`);
		close(line.rect[2], 180, `${line.items[0].str} 右边界`);
	}
});

test('横向短划仍按笔迹跨度：竖向规则不误伤横向笔迹', () => {
	const items = [box('最大纵坡不应大于 3%', 100, 200, 120, 12)];
	// 只有 15pt 的横划，纵向跨度为 0，不该被「竖向为主」规则铺满整行
	const lines = strokeToLines(items, stroke([[160, 202], [175, 202]]));
	assert.equal(lines.length, 1);
	close(lines[0].rect[0], 159, '左边界');
	close(lines[0].rect[2], 176, '右边界');
	assert.ok(lines[0].rect[2] - lines[0].rect[0] < 120, '行带应远窄于文字项');
});

test('竖向规则临界值触发侧：纵向恰好 2×横向 + 字高 → 铺满整行', () => {
	const items = [
		box('第一行文字', 100, 300, 80, 12),
		box('第二行文字', 100, 280, 80, 12),
	];
	// 纵向跨度 40，横向跨度 14：40 >= 2*14 + 12 = 40，恰好达标
	const lines = strokeToLines(items, stroke([[130, 310], [144, 270]]));
	assert.equal(lines.length, 2);
	close(lines[0].rect[0], 100, '左边界铺满');
	close(lines[0].rect[2], 180, '右边界铺满');
	close(lines[1].rect[0], 100, '第二行左边界铺满');
	close(lines[1].rect[2], 180, '第二行右边界铺满');
});

test('竖向规则临界值未触发侧：纵向不足 2×横向 + 字高 → 退回笔迹跨度', () => {
	const items = [
		box('第一行文字', 100, 300, 80, 12),
		box('第二行文字', 100, 280, 80, 12),
	];
	// 横向跨度 15：40 >= 2*15 + 12 = 42 不成立，仍按笔迹跨度吸附
	const lines = strokeToLines(items, stroke([[130, 310], [145, 270]]));
	assert.equal(lines.length, 2);
	assert.ok(lines[0].rect[2] - lines[0].rect[0] < 80, '行带应窄于整行');
	close(lines[0].rect[0], 129, '左边界为笔迹跨度左端');
	assert.ok(lines[0].rect[2] < 180, '右边界未铺满整行');
});

