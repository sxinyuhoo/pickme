import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EN, setLanguage, t } from '../src/i18n.ts';

const srcDir = fileURLToPath(new URL('../src', import.meta.url));

function walk(dir: string): string[] {
	return readdirSync(dir).flatMap((name) => {
		const full = join(dir, name);
		if (statSync(full).isDirectory()) return walk(full);
		return full.endsWith('.ts') ? [full] : [];
	});
}

/** 从源码里抠出所有 t('…') 的中文原文（就是查表的 key） */
function usedKeys(): string[] {
	// tKey('…') 是「渲染时再翻译」的 key（图标按钮的标签），一并算作使用中
	const pattern = /(?<![A-Za-z0-9_$])(?:t|tKey)\(\s*'((?:[^'\\]|\\.)*)'/g;
	const keys = new Set<string>();
	for (const file of walk(srcDir)) {
		const text = readFileSync(file, 'utf8');
		for (const match of text.matchAll(pattern)) {
			// 源码里的 \n 是转义写法，运行时是真换行，这里按运行时取值对齐
			keys.add(match[1].replace(/\\n/g, '\n').replace(/\\'/g, "'"));
		}
	}
	return [...keys];
}

test('默认语言是英文', () => {
	setLanguage(undefined);
	assert.equal(t('发送'), 'Send');
	assert.equal(t('深度思考'), 'Deep thinking');
});

test('切到中文时用原文，未知语言回落英文', () => {
	setLanguage('zh');
	assert.equal(t('发送'), '发送');
	setLanguage('en');
	assert.equal(t('发送'), 'Send');
	setLanguage('fr');
	assert.equal(t('发送'), 'Send', '认不出的语言值按默认英文处理');
});

test('表里没有的条目回落成中文原文，不会变成空串', () => {
	setLanguage('en');
	assert.equal(t('这句还没翻译'), '这句还没翻译');
});

test('占位符按名字替换，认不出的占位符原样留着', () => {
	setLanguage('zh');
	assert.equal(t('第 {v0} 次提问', { v0: 3 }), '第 3 次提问');
	setLanguage('en');
	assert.equal(t('第 {v0} 次提问', { v0: 3 }), 'Question 3');
	assert.equal(t('第 {v0} 次提问', { v1: 3 }), 'Question {v0}');
	assert.equal(t('第 {v0} 次提问', { v0: 0 }), 'Question 0', '0 也要能填进去');
});

test('源码里用到的每条文案都有英文译文', () => {
	const missing = usedKeys().filter((key) => !(key in EN));
	assert.deepEqual(missing, [], `这些文案缺英文译文：\n${missing.join('\n')}`);
});

test('英文表里没有多余条目（源里已删的文案要一起清掉）', () => {
	const used = new Set(usedKeys());
	const extra = Object.keys(EN).filter((key) => !used.has(key));
	assert.deepEqual(extra, [], `这些译文在源码里已经没有对应文案了：\n${extra.join('\n')}`);
});
