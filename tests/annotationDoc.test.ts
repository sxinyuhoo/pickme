import test from 'node:test';
import assert from 'node:assert/strict';
import {
	countQAs,
	parseAnnotationDoc,
	renderAnnotationDoc,
} from '../src/core/annotationDoc.ts';
import type { AnnotationDoc } from '../src/core/types.ts';

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
