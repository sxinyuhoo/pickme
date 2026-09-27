import type { QA } from './types.ts';

export interface ChatMessage {
	role: 'system' | 'user' | 'assistant';
	content: string;
}

export interface HistoryOptions {
	/** 最多带几轮历史问答 */
	rounds?: number;
	/** 每条回答最多取多少字符 */
	maxAnswerChars?: number;
}

/** 把同一锚点下的历史问答拼成对话消息，用于追问 */
export function buildHistoryMessages(qas: QA[], options: HistoryOptions = {}): ChatMessage[] {
	const rounds = options.rounds ?? 3;
	const maxAnswer = options.maxAnswerChars ?? 800;
	const recent = qas.filter((qa) => qa.answer.trim() !== '').slice(-rounds);

	const messages: ChatMessage[] = [];
	for (const qa of recent) {
		messages.push({ role: 'user', content: qa.question || '请说明这段内容。' });
		messages.push({ role: 'assistant', content: truncate(qa.answer, maxAnswer) });
	}
	return messages;
}

/** 供模板变量 {{已有批注}} 使用的纯文本历史 */
export function historyText(qas: QA[], options: HistoryOptions = {}): string {
	const rounds = options.rounds ?? 3;
	const maxAnswer = options.maxAnswerChars ?? 400;
	const recent = qas.filter((qa) => qa.answer.trim() !== '').slice(-rounds);
	return recent
		.map((qa, index) => {
			const question = qa.question || '请说明这段内容。';
			return `第 ${index + 1} 轮\n问：${question}\n答：${truncate(qa.answer, maxAnswer)}`;
		})
		.join('\n\n');
}

function truncate(text: string, limit: number): string {
	const trimmed = text.trim();
	if (limit <= 0 || trimmed.length <= limit) return trimmed;
	return `${trimmed.slice(0, limit)}……`;
}

/** 交给模型的结果里跟「回答文本」有关的那几个字段 */
export interface AnswerSource {
	text: string;
	/** 被中止或超时时为 true */
	aborted?: boolean;
	/** 推理型模型单独回传的思考内容 */
	reasoning?: string;
	/** 结束原因，'length' 表示被 max_tokens 截断 */
	finishReason?: string;
}

/** 思考内容写进批注时的上限，避免一条批注被思考过程灌满 */
const REASONING_LIMIT = 1200;

/**
 * 把模型返回的结果折成写进批注的文本。
 *
 * 推理型模型（如 deepseek 的 v4.x）把思考放在 delta.reasoning_content 里，
 * 思考同样计入 max_tokens：思考吃满上限时正文整段为空。这时若只报「模型没有返回内容」，
 * 用户看不出真实原因——要把思考过程接住，并给出「调大最大输出长度」的指引。
 */
export function buildAnswerText(result: AnswerSource): string {
	const text = (result.text ?? '').trim();
	if (text) {
		return result.aborted ? `${text}\n\n（已中止，以上为已完成部分）` : text;
	}
	const truncated = result.finishReason === 'length';
	const thought = (result.reasoning ?? '').trim();
	if (thought) {
		const head = truncated
			? '（模型只输出了思考内容就被截断了：思考也算 token，可在设置里调大「最大输出长度」。以下是它的思考过程）'
			: '（模型只返回了思考内容，没有给出结论。以下是它的思考过程）';
		return `${head}\n\n${truncate(thought, REASONING_LIMIT)}`;
	}
	if (truncated) {
		return '（输出被最大长度截断，模型没有给出内容。可在设置里调大「最大输出长度」，或换一个非推理模型）';
	}
	return result.aborted ? '（已中止，模型没有返回内容）' : '（模型没有返回内容）';
}
