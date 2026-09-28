import test from 'node:test';
import assert from 'node:assert/strict';
import {
	countQAs,
	parseAnnotationDoc,
	renderAnnotationDoc,
} from '../src/core/annotationDoc.ts';
import { shapesOf } from '../src/core/types.ts';
import type { AnnotationDoc, AnnotationEntry, PdfAnchorInfo, PdfShape } from '../src/core/types.ts';

/** 造一条 PDF 批注，默认是「只有外接矩形、没有 shapes」的老形态 */
function pdfEntry(pdf: Partial<PdfAnchorInfo>): AnnotationEntry {
	return {
		id: 's1a2b3',
		kind: 'pdf',
		selection: '',
		fingerprint: 'c0ffee00',
		status: 'ok',
		created: '2026-09-28T10:00:00+08:00',
		qas: [],
		pdf: {
			page: 3,
			pageSize: [595, 842],
			rect: [100, 182, 300, 260],
			normRect: [0.1681, 0.2162, 0.5042, 0.3088],
			hitText: '',
			image: '',
			...pdf,
		},
	};
}

function sampleDoc(): AnnotationDoc {
	return {
		sourcePath: '10-项目/论文/空间检索论文.md',
		sourceType: 'md',
		selfPath: '30-批注/10-项目/论文/空间检索论文.md',
		created: '2026-09-24T15:40:00+08:00',
		updated: '2026-09-24T15:52:00+08:00',
		entries: [
			{
				id: 'k7f3q2',
				kind: 'text',
				selection: '本体驱动的全路网空间检索引擎',
				fingerprint: 'a1b2c3d4',
				status: 'ok',
				created: '2026-09-24T15:40:00+08:00',
				qas: [
					{
						question: '这句话的核心贡献是什么？',
						template: '解释',
						answer: '一句话结论：\n\n- 要点一\n- 要点二',
						created: '2026-09-24T15:40:00+08:00',
					},
					{
						question: '与已有工作的差异在哪。',
						template: '',
						answer: '差异在于……',
						created: '2026-09-24T15:45:00+08:00',
					},
				],
			},
			{
				id: 'm1p8x4',
				kind: 'pdf',
				selection: '',
				fingerprint: 'f0e1d2c3',
				status: 'stale',
				created: '2026-09-24T15:50:00+08:00',
				qas: [
					{
						question: '这段规范要求了什么？',
						template: '',
						answer: '要求……',
						created: '2026-09-24T15:50:00+08:00',
					},
				],
				pdf: {
					page: 12,
					pageSize: [595, 842],
					rect: [100, 200, 300, 260],
					normRect: [0.1681, 0.2375, 0.5042, 0.3088],
					hitText: '最大纵坡不应大于',
					image: '30-批注/_assets/行业标准.pdf.md/2.png',
				},
			},
		],
	};
}

test('渲染出的 frontmatter 字段齐备且是中文键', () => {
	const text = renderAnnotationDoc(sampleDoc());
	for (const key of ['类型', '源文档', '源路径', '源类型', '批注版本', '创建', '更新', '批注条数']) {
		assert.ok(text.includes(`${key}:`), `缺少字段 ${key}`);
	}
	assert.ok(text.includes('源文档: "[[空间检索论文]]"'));
	assert.ok(text.includes('源路径: 10-项目/论文/空间检索论文.md'));
	assert.ok(text.includes('批注条数: 2'));
});

test('字段缺失时不把 undefined 写进文件', () => {
	// 手搓/半截数据很容易留下 fingerprint、created 缺失的条目，
	// 渲染时写进「- 定位指纹：undefined」这种东西，用户看到的就是界面上的 undefined
	const doc = sampleDoc();
	const entry = doc.entries[1];
	entry.fingerprint = undefined as unknown as string;
	entry.created = undefined as unknown as string;
	const text = renderAnnotationDoc(doc);
	assert.ok(!/undefined/.test(text), '渲染结果里不该出现 undefined 字面量');
	assert.ok(text.includes('- 定位指纹：\n'), '缺失的指纹应当留空');
});

test('渲染与解析往返不丢信息', () => {
	const doc = sampleDoc();
	const parsed = parseAnnotationDoc(renderAnnotationDoc(doc), doc.selfPath);

	assert.equal(parsed.sourcePath, doc.sourcePath);
	assert.equal(parsed.sourceType, 'md');
	assert.equal(parsed.entries.length, 2);
	assert.equal(countQAs(parsed.entries), 3);

	const [first, second] = parsed.entries;
	assert.equal(first.id, 'k7f3q2');
	assert.equal(first.kind, 'text');
	assert.equal(first.selection, '本体驱动的全路网空间检索引擎');
	assert.equal(first.fingerprint, 'a1b2c3d4');
	assert.equal(first.status, 'ok');
	assert.equal(first.qas.length, 2);
	assert.equal(first.qas[0].question, '这句话的核心贡献是什么？');
	assert.equal(first.qas[0].template, '解释');
	assert.equal(first.qas[0].answer, '一句话结论：\n\n- 要点一\n- 要点二');
	assert.equal(first.qas[1].question, '与已有工作的差异在哪。');
	assert.equal(first.qas[1].answer, '差异在于……');

	assert.equal(second.kind, 'pdf');
	assert.equal(second.status, 'stale');
	assert.deepEqual(second.pdf?.rect, [100, 200, 300, 260]);
	assert.equal(second.pdf?.page, 12);
	assert.deepEqual(second.pdf?.pageSize, [595, 842]);
	assert.equal(second.pdf?.hitText, '最大纵坡不应大于');
	assert.equal(second.pdf?.image, '30-批注/_assets/行业标准.pdf.md/2.png');
});

test('回答里的空行与列表不会被截断', () => {
	const doc = sampleDoc();
	doc.entries = [doc.entries[0]];
	const parsed = parseAnnotationDoc(renderAnnotationDoc(doc), doc.selfPath);
	assert.equal(parsed.entries[0].qas[0].answer.split('\n').length, 4);
});

test('解析容错：没有 frontmatter 的文件不抛错', () => {
	const parsed = parseAnnotationDoc('## 锚点 abc123\n\n- 类型：文本\n- 选区：某段话\n', 'x.md');
	assert.equal(parsed.entries.length, 1);
	assert.equal(parsed.entries[0].selection, '某段话');
	assert.deepEqual(parsed.entries[0].qas, []);
});

test('框+线复合批注：形状集合、颜色、旋转往返后逐项相等', () => {
	const doc = sampleDoc();
	const shapes: PdfShape[] = [
		{ kind: 'line', rect: [100, 240, 300, 255], norm: [0.1681, 0.285, 0.5042, 0.3029] },
		{ kind: 'line', rect: [100, 222, 300, 237], norm: [0.1681, 0.2637, 0.5042, 0.2815] },
		{ kind: 'line', rect: [100, 204, 300, 219], norm: [0.1681, 0.2423, 0.5042, 0.2601] },
		{ kind: 'area', rect: [100, 182, 300, 260], norm: [0.1681, 0.2162, 0.5042, 0.3088] },
	];
	doc.entries = [
		pdfEntry({
			shapes,
			color: '#98cbed',
			rotation: 90,
			hitText: '最大纵坡不应大于 3%',
		}),
	];

	const text = renderAnnotationDoc(doc);
	assert.ok(text.includes('- 形状：框+线'), '复合批注要写「框+线」');
	assert.ok(text.includes('- 颜色：#98cbed'), '非默认色要落盘');
	assert.ok(text.includes('- 页面旋转：90'), '非零旋转要落盘');
	assert.ok(text.includes('- 荧光行：'), '线形状写用户空间荧光行');
	assert.ok(text.includes('- 框：'), '框形状写用户空间框');

	const parsed = parseAnnotationDoc(text, doc.selfPath);
	const pdf = parsed.entries[0].pdf;
	assert.ok(pdf);
	assert.equal(pdf.shapes?.length, 4);
	assert.deepEqual(pdf.shapes?.map((s) => s.kind), ['line', 'line', 'line', 'area']);
	assert.deepEqual(pdf.shapes?.map((s) => s.norm), shapes.map((s) => s.norm));
	assert.equal(pdf.color, '#98cbed');
	assert.equal(pdf.rotation, 90);
	// 解析出的形状集合就是 shapesOf 的结果，业务侧不要再直接读 shapes
	assert.deepEqual(shapesOf(pdf), pdf.shapes);
});

test('多行命中文本往返后完整保留（修复只留第一行的缺陷）', () => {
	const doc = sampleDoc();
	const hitText = '最大纵坡不应大于 3%，隧道段可放宽至 4%\n二三级公路按 8% 控制\n第四行也要留住';
	doc.entries = [pdfEntry({ hitText })];

	const text = renderAnnotationDoc(doc);
	assert.ok(text.includes('### 命中文本'), '完整文字要落成小节');
	assert.ok(
		text.includes('- 命中文本：最大纵坡不应大于 3%，隧道段可放宽至 4%'),
		'bullet 只放单行摘要，且不含后续行',
	);

	const parsed = parseAnnotationDoc(text, doc.selfPath);
	assert.equal(parsed.entries[0].pdf?.hitText, hitText);
	assert.equal(parsed.entries[0].pdf?.hitText.split('\n').length, 3);

	// 空行与长行都不该被吃掉；摘要在 120 字处截断
	const long = `${'甲'.repeat(200)}\n第二行`;
	const longDoc = sampleDoc();
	longDoc.entries = [pdfEntry({ hitText: long })];
	const longText = renderAnnotationDoc(longDoc);
	const summary = longText.split('\n').find((line) => line.startsWith('- 命中文本：')) ?? '';
	assert.equal(summary.length, '- 命中文本：'.length + 120);
	assert.equal(parseAnnotationDoc(longText, longDoc.selfPath).entries[0].pdf?.hitText, long);
});

test('老格式文本解析后 shapes 为 undefined，shapesOf 退化成单个框', () => {
	const old = [
		'## 锚点 old001',
		'',
		'- 类型：PDF 区域',
		'- 锚点 id：old001',
		'- 定位指纹：abc123',
		'- 状态：有效',
		'- 创建：2026-01-01T00:00:00+08:00',
		'- 页码：5',
		'- 页面尺寸：595x842',
		'- 矩形：100,200,300,260',
		'- 归一化矩形：0.1681,0.2375,0.5042,0.3088',
		'- 命中文本：只有一行的老批注',
		'',
	].join('\n');

	const parsed = parseAnnotationDoc(old, 'x.md');
	const pdf = parsed.entries[0].pdf;
	assert.ok(pdf);
	assert.equal(pdf.shapes, undefined, '没有新字段时不该造出 shapes');
	assert.equal(pdf.color, undefined);
	assert.equal(pdf.rotation, undefined);
	assert.equal(pdf.hitText, '只有一行的老批注');

	const shapes = shapesOf(pdf);
	assert.equal(shapes.length, 1);
	assert.equal(shapes[0].kind, 'area');
	assert.deepEqual(shapes[0].norm, [0.1681, 0.2375, 0.5042, 0.3088]);
	assert.deepEqual(shapes[0].rect, [100, 200, 300, 260]);
});

test('只有线形状的批注，形状字段写「线」', () => {
	const doc = sampleDoc();
	doc.entries = [
		pdfEntry({
			shapes: [
				{ kind: 'line', rect: [100, 240, 300, 255], norm: [0.1681, 0.285, 0.5042, 0.3029] },
				{ kind: 'line', rect: [100, 222, 300, 237], norm: [0.1681, 0.2637, 0.5042, 0.2815] },
			],
		}),
	];

	const text = renderAnnotationDoc(doc);
	assert.ok(text.includes('- 形状：线'), '纯荧光笔批注写「线」');
	assert.ok(text.includes('- 归一化荧光行：'));
	assert.ok(!text.includes('- 框：'), '没有框形状时不该写「框」');
	assert.ok(!text.includes('- 归一化框：'));

	const parsed = parseAnnotationDoc(text, doc.selfPath);
	assert.deepEqual(parsed.entries[0].pdf?.shapes?.map((s) => s.kind), ['line', 'line']);
});

test('解析容错：坏掉的坐标片段跳过，形状字段缺失时回退到用户空间', () => {
	// 归一化字段整段毁掉 → 应当用「荧光行」按页面尺寸换算回来
	const fallback = parseAnnotationDoc(
		[
			'## 锚点 f001',
			'',
			'- 类型：PDF 区域',
			'- 形状：线',
			'- 页面尺寸：595x842',
			'- 矩形：100,200,300,260',
			'- 归一化矩形：0.1681,0.2375,0.5042,0.3088',
			'- 荧光行：119,210.5,238,421',
			'- 归一化荧光行：garbage',
			'',
		].join('\n'),
		'x.md',
	);
	const shapes = fallback.entries[0].pdf?.shapes ?? [];
	assert.equal(shapes.length, 1);
	assert.equal(shapes[0].kind, 'line');
	assert.deepEqual(shapes[0].norm, [0.2, 0.25, 0.4, 0.5]);

	// 坐标片段坏一个只丢那一个，其余照常解析
	const partial = parseAnnotationDoc(
		[
			'## 锚点 f002',
			'',
			'- 类型：PDF 区域',
			'- 页面尺寸：100x100',
			'- 归一化荧光行：0.1,0.2,0.3,0.4;坏;0.5,0.6,0.7,0.8',
			'',
		].join('\n'),
		'x.md',
	);
	assert.deepEqual(partial.entries[0].pdf?.shapes?.map((s) => s.norm), [
		[0.1, 0.2, 0.3, 0.4],
		[0.5, 0.6, 0.7, 0.8],
	]);
});
