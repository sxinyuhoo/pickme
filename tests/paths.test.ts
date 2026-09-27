import test from 'node:test';
import assert from 'node:assert/strict';
import {
	assetPath,
	isAnnotationFile,
	sidecarName,
	sidecarPath,
	sourceNameFromSidecar,
	sourcePathFromSidecar,
} from '../src/core/paths.ts';

test('文件名换算：Markdown 同名，其他源后缀加 .md', () => {
	assert.equal(sidecarName('空间检索论文.md'), '空间检索论文.md');
	assert.equal(sidecarName('行业标准.pdf'), '行业标准.pdf.md');
	assert.equal(sourceNameFromSidecar('空间检索论文.md'), '空间检索论文.md');
	assert.equal(sourceNameFromSidecar('行业标准.pdf.md'), '行业标准.pdf');
	assert.equal(sourceNameFromSidecar('论文v1.0.md'), '论文v1.0.md');
	assert.equal(sourceNameFromSidecar('报告-20260924.docx.md'), '报告-20260924.docx');
});

test('批注路径镜像源文档目录结构', () => {
	const dir = '.obsidian/plugins/pickme/annotations';
	assert.equal(sidecarPath('10-项目/论文/空间检索论文.md', dir), `${dir}/10-项目/论文/空间检索论文.md`);
	assert.equal(sidecarPath('行业标准.pdf', dir), `${dir}/行业标准.pdf.md`);
	assert.equal(sidecarPath('空间检索论文.md', ''), '空间检索论文.md');
});

test('路径往返还原一致', () => {
	const dir = '.obsidian/plugins/pickme/annotations';
	for (const source of ['10-项目/论文/空间检索论文.md', '行业标准.pdf', 'a/b/c/x.docx']) {
		assert.equal(sourcePathFromSidecar(sidecarPath(source, dir), dir), source);
	}
});

test('只把真正的批注文件纳入索引，排除插件自己的内部目录', () => {
	const dir = '30-批注';
	assert.equal(isAnnotationFile('30-批注/论文/a.md', dir), true);
	assert.equal(isAnnotationFile('30-批注/_模板/解释.md', dir), false);
	assert.equal(isAnnotationFile('30-批注/_assets/论文/a.md/1.png', dir), false);
	assert.equal(isAnnotationFile('10-项目/a.md', dir), false);
	// 目录名以 _ 开头、但不是内部目录的照常算批注
	assert.equal(isAnnotationFile('30-批注/_草稿/a.md', dir), true);
	// 文件名以 _ 开头也不算例外：用户把文档命名成 _draft.md 时批注照样要进索引
	assert.equal(isAnnotationFile('30-批注/_draft.md', dir), true);
	assert.equal(isAnnotationFile('30-批注/01-收件箱/_pickme测试.md', dir), true);
});

test('区域截图路径按条目序号生成', () => {
	assert.equal(
		assetPath('30-批注/行业标准.pdf.md', '30-批注', 2),
		'30-批注/_assets/行业标准.pdf.md/2.png',
	);
});
