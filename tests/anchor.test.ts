import test from 'node:test';
import assert from 'node:assert/strict';
import {
	DEFAULT_TAG,
	anchorTag,
	fingerprint,
	insertAnchors,
	matchEntries,
	newAnchorId,
	removeAnchors,
	scanAnchors,
	stripAnchors,
} from '../src/core/anchor.ts';

test('锚点 id 是 6 位小写字母数字', () => {
	for (let i = 0; i < 50; i++) {
		assert.match(newAnchorId(), /^[a-z0-9]{6}$/);
	}
});

test('锚点标签形态固定为带 id 的空标签对', () => {
	assert.equal(anchorTag('k7f3q2'), '<pickme id="k7f3q2"></pickme>');
	assert.equal(anchorTag('k7f3q2', 'mytag'), '<mytag id="k7f3q2"></mytag>');
});

test('插入锚点后扫描能还原选区，且原文其他字节不变', () => {
	const source = '前言。本体驱动的全路网空间检索引擎是核心。后记。';
	const from = source.indexOf('本体驱动');
	const to = from + '本体驱动的全路网空间检索引擎'.length;
	const withAnchor = insertAnchors(source, from, to, 'k7f3q2');
	assert.equal(stripAnchors(withAnchor), source);

	const scan = scanAnchors(withAnchor);
	assert.equal(scan.pairs.length, 1);
	assert.equal(scan.pairs[0].id, 'k7f3q2');
	assert.equal(scan.pairs[0].text, '本体驱动的全路网空间检索引擎');
	assert.deepEqual(scan.broken, []);
	assert.equal(scan.malformed, 0);
});

test('锚点不包裹选区文字，格式标记留在标签外面', () => {
	const source = '这里含**粗体**与*斜体*。';
	const from = source.indexOf('含');
	const to = source.indexOf('。');
	const out = insertAnchors(source, from, to, 'abc123');
	assert.equal(out, `这里<${DEFAULT_TAG} id="abc123"></${DEFAULT_TAG}>含**粗体**与*斜体*<${DEFAULT_TAG} id="abc123"></${DEFAULT_TAG}>。`);
	assert.equal(scanAnchors(out).pairs[0].text, '含**粗体**与*斜体*');
});

test('同一个 id 只出现一次时判定为损坏，且不影响其他锚点', () => {
	const a = insertAnchors('第一段文字', 0, 2, 'aaa111');
	const b = insertAnchors('第二段文字', 0, '第二段文字'.length, 'bbb222');
	const damaged = a.replace(anchorTag('aaa111'), '');
	const scan = scanAnchors(damaged + b);
	assert.deepEqual(scan.broken, ['aaa111']);
	assert.equal(scan.pairs.length, 1);
	assert.equal(scan.pairs[0].id, 'bbb222');
	assert.equal(scan.pairs[0].text, '第二段文字');
});

test('同一行两个相邻锚点互不干扰', () => {
	let text = '第一处选区中间文字第二处选区。';
	text = insertAnchors(text, 0, 5, 'b2n7c3');
	const secondFrom = text.indexOf('第二处选区');
	text = insertAnchors(text, secondFrom, secondFrom + 5, 'd5k9f8');

	const scan = scanAnchors(text);
	assert.deepEqual(scan.pairs.map((p) => p.id), ['b2n7c3', 'd5k9f8']);
	assert.deepEqual(scan.pairs.map((p) => p.text), ['第一处选区', '第二处选区']);
	assert.equal(stripAnchors(text), '第一处选区中间文字第二处选区。');
});

test('跨段落选区与整行选区都能配对', () => {
	const source = '第一段**粗体**。\n\n第二段文字。';
	const out = insertAnchors(source, 0, source.length, 'z9q2w7');
	const scan = scanAnchors(out);
	assert.equal(scan.pairs[0].text, source);
	assert.deepEqual(scan.broken, []);
});

test('删除锚点只影响指定 id', () => {
	let text = '甲段落乙段落';
	text = insertAnchors(text, 0, 1, 'aaa111');
	const secondFrom = text.indexOf('乙');
	text = insertAnchors(text, secondFrom, secondFrom + 1, 'bbb222');

	const removedFirst = removeAnchors(text, 'aaa111');
	assert.equal(stripAnchors(removedFirst), '甲段落乙段落');
	assert.deepEqual(scanAnchors(removedFirst).broken, []);
	assert.deepEqual(scanAnchors(removedFirst).pairs.map((p) => p.id), ['bbb222']);
	assert.deepEqual(scanAnchors(removeAnchors(removedFirst, 'bbb222')).pairs, []);
	assert.equal(stripAnchors(text), '甲段落乙段落');
});

test('选区越界或为空时拒绝插入', () => {
	assert.throws(() => insertAnchors('文字', 2, 1, 'aaa111'));
	assert.throws(() => insertAnchors('文字', 0, 9, 'aaa111'));
	assert.throws(() => insertAnchors('文字', 0.5, 1, 'aaa111'));
});

test('指纹忽略空白差异，内容变了才变', () => {
	assert.equal(fingerprint('本体 驱动\n的引擎'), fingerprint('本体 驱动 的引擎'));
	assert.notEqual(fingerprint('本体驱动的引擎'), fingerprint('本体驱动的引警'));
});

test('匹配条目：id 命中为 ok，仅文本命中为 rebind，都找不到为 stale', () => {
	const scan = scanAnchors(insertAnchors('甲选区文字', 0, 1, 'aaa111'));
	const unique = scanAnchors(insertAnchors('乙选区文字', 0, 1, 'bbb222'));
	const merged = { pairs: [...scan.pairs, ...unique.pairs], malformed: 0, broken: [] };

	const result = matchEntries(
		[
			{ id: 'aaa111', selection: '甲' },
			{ id: 'ccc333', selection: '乙' },
			{ id: 'ddd444', selection: '不存在' },
		],
		merged,
	);
	assert.equal(result.get('aaa111'), 'ok');
	assert.equal(result.get('ccc333'), 'rebind');
	assert.equal(result.get('ddd444'), 'stale');
});

test('id 命中但选区文本被改写时提示重新绑定', () => {
	const scan = scanAnchors(insertAnchors('甲选区文字', 0, 1, 'aaa111'));
	const result = matchEntries([{ id: 'aaa111', selection: '改过的文字' }], scan);
	assert.equal(result.get('aaa111'), 'rebind');
});
