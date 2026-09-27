import test from 'node:test';
import assert from 'node:assert/strict';
import {
	DEFAULT_TEMPLATES,
	TEMPLATE_VARS,
	defaultTemplateFiles,
	parseTemplate,
	renderPrompt,
	trimSelection,
} from '../src/core/template.ts';

test('内置模板只留解释、摘要、翻译三个', () => {
	const files = defaultTemplateFiles('90-模板/pickme');
	assert.equal(files.length, DEFAULT_TEMPLATES.length);
	assert.equal(files.length, 3);
	assert.ok(files.every((f) => f.path.startsWith('90-模板/pickme/') && f.path.endsWith('.md')));
	const names = DEFAULT_TEMPLATES.map((t) => t.name);
	assert.deepEqual(names, ['解释', '摘要', '翻译']);
});

test('内置模板把「具体问题」写成可选段落，用户不必自己补占位符', () => {
	for (const template of DEFAULT_TEMPLATES) {
		assert.ok(template.prompt.includes('{{提问}}'), `${template.name} 应当带上提问占位符`);
	}
	// 问题为空时，「另外回答这个问题：」这一整段要消失，而不是留个空标签
	const template = DEFAULT_TEMPLATES[1];
	const prompt = renderPrompt(template.prompt, { 选区: '一段文字', 提问: '' });
	assert.ok(!prompt.includes('{{提问}}'), '空占位符不该留在提示词里');
	assert.ok(!prompt.includes('另外回答这个问题'), '只剩引导词的那一行应当整行去掉');
	assert.ok(prompt.includes('一段文字'), '选区文字要留着');
	// 有问的时候要带上
	const asked = renderPrompt(template.prompt, { 选区: '一段文字', 提问: '这里说的是什么？' });
	assert.ok(asked.includes('另外回答这个问题：这里说的是什么？'), `问题应当带上去，实际：${asked}`);
	// 整行只有一个未知变量时保持原样
	assert.equal(renderPrompt('{{未知变量}}', {}), '{{未知变量}}');
});

test('内置模板默认都带选区变量', () => {
	for (const template of DEFAULT_TEMPLATES) {
		assert.ok(template.prompt.includes('{{选区}}'), `${template.name} 缺少选区变量`);
	}
});

test('模板文件用 ASCII 键写 frontmatter，写入的配置能原样读回', () => {
	const files = defaultTemplateFiles('90-模板/pickme');
	const text = files[0].content;
	assert.ok(text.includes('pickme_model:'));
	assert.ok(text.includes('pickme_temperature:'));
	assert.ok(text.includes('pickme_include_note:'));
	assert.ok(text.includes('pickme_vision:'));
	assert.ok(text.includes('pickme_context:'));
	const parsed = parseTemplate('解释', text);
	assert.equal(parsed.name, '解释');
	assert.equal(parsed.config.includeNote, false);
	assert.equal(parsed.config.vision, true);
	assert.equal(parsed.config.context, true);
	assert.ok(parsed.prompt.includes('{{选区}}'));
});

test('模板 frontmatter 用 pickme_ 前缀覆盖配置', () => {
	const text = [
		'---',
		'pickme_model: qwen-max',
		'pickme_temperature: 0.2',
		'pickme_include_note: true',
		'pickme_vision: false',
		'pickme_context: false',
		'---',
		'',
		'请解释：{{选区}}',
	].join('\n');
	const template = parseTemplate('解释', text);
	assert.equal(template.config.model, 'qwen-max');
	assert.equal(template.config.temperature, 0.2);
	assert.equal(template.config.includeNote, true);
	assert.equal(template.config.vision, false);
	assert.equal(template.config.context, false);
	assert.equal(template.prompt, '请解释：{{选区}}');
});

test('早期用中文键写的模板仍然可读', () => {
	const text = [
		'---',
		'pickme_模型: qwen-plus',
		'pickme_温度: 0.5',
		'pickme_带全文: true',
		'pickme_带上下文: false',
		'---',
		'',
		'{{选区}}',
	].join('\n');
	const template = parseTemplate('旧模板', text);
	assert.equal(template.config.model, 'qwen-plus');
	assert.equal(template.config.temperature, 0.5);
	assert.equal(template.config.includeNote, true);
	assert.equal(template.config.context, false);
});

test('模板没有 frontmatter 时使用默认配置', () => {
	const template = parseTemplate('自定义', '只看我：{{选区}}');
	assert.equal(template.config.model, '');
	assert.equal(template.config.temperature, null);
	assert.equal(template.config.context, true);
	assert.equal(template.config.includeNote, false);
	assert.equal(template.config.vision, true);
});

test('规格里的变量名都能替换，别名同样生效', () => {
	const vars: Record<string, string> = {
		选区: '本体驱动',
		上下文: '上文片段',
		笔记标题: '空间检索论文',
		源路径: '10-项目/论文/空间检索.md',
		页码: '12',
		区域图片: '![[assets/p1.png]]',
		已有批注: '第 1 轮',
		提问: '贡献是什么',
	};
	const out = renderPrompt(
		'《{{笔记标题}}》{{源路径}} 第 {{页码}} 页：{{选区}}｜{{上下文}}｜{{区域图片}}｜{{已有批注}}｜问：{{提问}}',
		vars,
	);
	assert.equal(
		out,
		'《空间检索论文》10-项目/论文/空间检索.md 第 12 页：本体驱动｜上文片段｜![[assets/p1.png]]｜第 1 轮｜问：贡献是什么',
	);
	// 早期写法继续可用
	assert.equal(renderPrompt('{{文档标题}}／{{文档路径}}', vars), '空间检索论文／10-项目/论文/空间检索.md');
});

test('规格里的变量清单与实现一致', () => {
	assert.deepEqual([...TEMPLATE_VARS], [
		'选区',
		'上下文',
		'笔记标题',
		'源路径',
		'页码',
		'区域图片',
		'已有批注',
		'提问',
	]);
});

test('变量替换保留未知变量', () => {
	const out = renderPrompt('「{{选区}}」，{{未知变量}}', { 选区: 'x' });
	assert.equal(out, '「x」，{{未知变量}}');
});

test('选区过长时按上限截断并加提示', () => {
	assert.equal(trimSelection('  短文本  ', 100), '短文本');
	const long = '字'.repeat(20);
	const trimmed = trimSelection(long, 10);
	assert.ok(trimmed.startsWith('字'.repeat(10)));
	assert.ok(trimmed.includes('已截断'));
	assert.equal(trimSelection(long, 0), long);
});
