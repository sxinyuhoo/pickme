import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAnswerText, buildHistoryMessages, historyText } from '../src/core/qa.ts';
import type { QA } from '../src/core/types.ts';

function qa(question: string, answer: string): QA {
	return { question, template: '', answer, created: '2026-09-24T10:00:00+08:00' };
}

test('历史问答按 问-答 顺序拼成对话消息', () => {
	const messages = buildHistoryMessages([qa('第一问', '第一答'), qa('第二问', '第二答')]);
	assert.deepEqual(messages, [
		{ role: 'user', content: '第一问' },
		{ role: 'assistant', content: '第一答' },
		{ role: 'user', content: '第二问' },
		{ role: 'assistant', content: '第二答' },
	]);
});

test('空回答不进历史，只取最近几轮', () => {
	const list = [qa('一', '答一'), qa('二', ''), qa('三', '答三'), qa('四', '答四')];
	const messages = buildHistoryMessages(list, { rounds: 2 });
	assert.deepEqual(messages.map((m) => m.content), ['三', '答三', '四', '答四']);
});

test('过长的历史回答被截断', () => {
	const long = '答'.repeat(100);
	const messages = buildHistoryMessages([qa('问', long)], { maxAnswerChars: 10 });
	assert.equal(messages[1].content, `${'答'.repeat(10)}……`);
});

test('没有历史时返回空数组', () => {
	assert.deepEqual(buildHistoryMessages([]), []);
});

test('{{已有批注}} 的文本形式带轮次编号', () => {
	const text = historyText([qa('贡献是什么', '三点贡献'), qa('局限呢', '样本量偏小')]);
	assert.ok(text.includes('第 1 轮'));
	assert.ok(text.includes('问：贡献是什么'));
	assert.ok(text.includes('答：三点贡献'));
	assert.ok(text.includes('第 2 轮'));
	assert.equal(historyText([]), '');
});

test('提问为空时用兜底问句，不产生空消息', () => {
	const messages = buildHistoryMessages([qa('', '有回答')]);
	assert.equal(messages[0].content, '请说明这段内容。');
});

test('正常回答原样写回', () => {
	assert.equal(buildAnswerText({ text: '  这是一段回答。  ' }), '这是一段回答。');
});

test('被中止时标注已完成部分', () => {
	const text = buildAnswerText({ text: '半截内容', aborted: true });
	assert.ok(text.includes('半截内容'));
	assert.ok(text.includes('已中止'));
});

test('正文为空但只有思考内容时，把思考接住并说明原因', () => {
	// 推理型模型把思考放在 reasoning_content 里，思考吃满 max_tokens 时正文整段为空
	const text = buildAnswerText({
		text: '',
		reasoning: '先看选区，再想怎么说……',
		finishReason: 'length',
	});
	assert.ok(!text.includes('模型没有返回内容'), '不能只报「没有返回内容」，那样看不出真实原因');
	assert.ok(text.includes('思考过程'), '应当说明只拿到了思考过程');
	assert.ok(text.includes('最大输出长度'), '应当给出调大上限的指引');
	assert.ok(text.includes('先看选区'), '思考内容本身要保留');
});

test('思考内容过长时截断', () => {
	const text = buildAnswerText({ text: '', reasoning: '思'.repeat(3000) });
	assert.ok(text.length < 1500, `思考内容应当被截断，实际 ${text.length}`);
});

test('被截断且没有思考内容时给出可操作的原因', () => {
	const text = buildAnswerText({ text: '', finishReason: 'length' });
	assert.ok(text.includes('最大输出长度'));
});

test('真的什么都没有时保持原样提示', () => {
	assert.equal(buildAnswerText({ text: '' }), '（模型没有返回内容）');
	assert.equal(buildAnswerText({ text: '', aborted: true }), '（已中止，模型没有返回内容）');
});
