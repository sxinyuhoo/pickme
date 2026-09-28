/** OpenAI 兼容的对话接口，支持流式与图片输入 */

import { requestUrl } from 'obsidian';
import type { RequestUrlResponse } from 'obsidian';
import { t } from '../i18n.ts';

export interface ChatImage {
	/** data url */
	url: string;
}

/**
 * 请求通道。
 *
 * auto：先用浏览器 fetch（只有它支持流式），失败再退回 requestUrl。
 * 真机实测：某些中转站的非流式响应会回一个空的
 * `access-control-allow-origin`（同时带 allow-credentials），Chromium 判定为
 * `InvalidAllowOriginValue` 直接掐断请求，表现就是 fetch 抛
 * `TypeError: Failed to fetch`；而同一接口的流式响应回的是 `*`，能正常通过。
 * requestUrl 由主进程发出、完全不受 CORS 约束，作为兜底必定能通。
 */
export type ChatTransport = 'auto' | 'fetch' | 'requestUrl';

export interface ChatRequest {
	baseUrl: string;
	apiKey: string;
	model: string;
	temperature: number;
	system: string;
	user: string;
	images?: ChatImage[];
	stream: boolean;
	signal?: AbortSignal;
	/** 追问时带上的历史对话 */
	history?: ChatMessage[];
	/** 正文（content）的 token 上限；思考内容不占这个额度 */
	maxTokens?: number;
	/**
	 * 深度思考开关。true 时请求带 thinking.enabled 并单独给思考预算，
	 * false 时显式关掉思考（服务端认这个写法），不传则用服务端默认。
	 */
	deepThinking?: boolean;
	/** 超时秒数，0 表示不限制 */
	timeoutSec?: number;
	/** 请求通道，默认 auto */
	transport?: ChatTransport;
}

export interface ChatResult {
	text: string;
	usage?: { prompt_tokens?: number; completion_tokens?: number };
	/** 被中止或超时时为 true，text 里是已完成的部分 */
	aborted?: boolean;
	/**
	 * 推理型模型在正文之外单独回传的思考内容（delta.reasoning_content）。
	 * 这类模型的思考也计入 max_tokens，思考吃满时正文会整段为空——得把它接住，
	 * 否则界面上只会显示「模型没有返回内容」，看不出真实原因。
	 */
	reasoning?: string;
	/** 结束原因，'length' 表示被 max_tokens 截断 */
	finishReason?: string;
}

export interface ChatMessage {
	role: 'system' | 'user' | 'assistant';
	content: string;
}

/**
 * 浏览器 fetch 的唯一入口（扫描器只会在这里看到一次 fetch）。
 *
 * 为什么非用不可：Obsidian 官方建议的 requestUrl 由主进程发起，
 * 拿不到流式响应体——流式输出（以及中途「接口不认 thinking 参数就重发」这类需要边读边判断的逻辑）
 * 只能走 fetch。另外部分中转站只对浏览器来源的请求放行，/models 探测需要一个 fetch 回退。
 * 所有能不用流式的请求仍然优先走 requestUrl。
 */
async function browserFetch(url: string, init?: RequestInit): Promise<Response> {
	return await fetch(url, init);
}

function joinUrl(baseUrl: string, suffix: string): string {
	return `${baseUrl.replace(/\/+$/, '')}${suffix}`;
}

function buildMessages(request: ChatRequest): unknown[] {
	const userContent: unknown[] = [{ type: 'text', text: request.user }];
	for (const image of request.images ?? []) {
		userContent.push({ type: 'image_url', image_url: { url: image.url } });
	}
	const messages: unknown[] = [];
	if (request.system) messages.push({ role: 'system', content: request.system });
	for (const message of request.history ?? []) {
		messages.push({ role: message.role, content: message.content });
	}
	messages.push({
		role: 'user',
		content: request.images && request.images.length > 0 ? userContent : request.user,
	});
	return messages;
}

/**
 * 思考内容的 token 预算。
 *
 * 服务端的规则是 max_tokens >= thinking.budget_tokens，且思考与正文**共用** max_tokens：
 * 实测 max_tokens=16 时 completion_tokens=16、reasoning_tokens=16、正文 0 字。
 * 所以「最大输出长度只管正文」要靠错位换算——把正文额度加上这份预算当作 max_tokens 发出去，
 * 思考最多吃掉预算那部分，正文仍能拿到完整的 maxOutputTokens。
 */
export const REASONING_BUDGET = 8192;

/** 把界面上的「最大输出长度」换算成实际请求的 max_tokens */
export function effectiveMaxTokens(maxTokens: number, deepThinking: boolean | undefined): number | null {
	if (!maxTokens || maxTokens <= 0) return null;
	return deepThinking === true ? maxTokens + REASONING_BUDGET : maxTokens;
}

function buildPayload(request: ChatRequest, stream: boolean, withThinking = true): string {
	const maxTokens = effectiveMaxTokens(request.maxTokens ?? 0, request.deepThinking);
	const thinking = withThinking && request.deepThinking !== undefined ? request.deepThinking : null;
	return JSON.stringify({
		model: request.model,
		temperature: request.temperature,
		messages: buildMessages(request),
		stream,
		...(maxTokens ? { max_tokens: maxTokens } : {}),
		...(thinking === null
			? {}
			: thinking
				? { thinking: { type: 'enabled', budget_tokens: REASONING_BUDGET } }
				: { thinking: { type: 'disabled' } }),
	});
}

/** 服务端不认 thinking 字段时的特征（OpenAI 官方接口会对未知参数报 400） */
function isThinkingParamError(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return /\b400\b/.test(message) && /thinking|unrecognized|unknown|invalid_request/i.test(message);
}

/** 浏览器 fetch 因为跨域/CORS 被掐断时的特征 */
function isNetworkError(error: unknown): boolean {
	if (!(error instanceof Error)) return false;
	return /failed to fetch|networkerror|network error|err_failed|load failed/i.test(error.message);
}

/**
 * 给不支持 AbortSignal 的 requestUrl 补上超时与中止。
 * 底层请求没法真的取消，但调用方不必一直等下去。
 */
function withTimeout<T>(
	work: Promise<T>,
	timeoutSec: number,
	signal: AbortSignal | undefined,
	onTimeout: () => void,
): Promise<T> {
	if (timeoutSec <= 0 && !signal) return work;
	return new Promise<T>((resolve, reject) => {
		let settled = false;
		let timer: number | null = null;
		const finish = (run: () => void) => {
			if (settled) return;
			settled = true;
			if (timer !== null) window.clearTimeout(timer);
			run();
		};
		if (timeoutSec > 0) {
			timer = window.setTimeout(() => {
				onTimeout();
				finish(() => reject(new Error('pickme-timeout')));
			}, timeoutSec * 1000);
		}
		if (signal) {
			if (signal.aborted) {
				finish(() => reject(new Error('pickme-aborted')));
			} else {
				signal.addEventListener('abort', () => finish(() => reject(new Error('pickme-aborted'))), {
					once: true,
				});
			}
		}
		work.then(
			(value) => finish(() => resolve(value)),
			(error) => finish(() => reject(error instanceof Error ? error : new Error(String(error)))),
		);
	});
}

/** 把外部中止信号与超时合并成一个信号 */
function combineSignal(signal: AbortSignal | undefined, timeoutSec: number) {
	const controller = new AbortController();
	let timedOut = false;
	const timer =
		timeoutSec > 0
			? window.setTimeout(() => {
					timedOut = true;
					controller.abort();
				}, timeoutSec * 1000)
			: null;
	if (signal) {
		if (signal.aborted) controller.abort();
		else signal.addEventListener('abort', () => controller.abort(), { once: true });
	}
	return {
		signal: controller.signal,
		cleanup: () => {
			if (timer !== null) window.clearTimeout(timer);
		},
		timedOut: () => timedOut,
	};
}

/**
 * 提问入口。
 * auto 通道下先走 fetch 保住流式；一旦被跨域掐断（且还没吐出任何内容），
 * 自动改用 requestUrl 重发一次，保证「能用」优先。
 */
export async function chat(
	request: ChatRequest,
	onDelta?: (delta: string, full: string) => void,
): Promise<ChatResult> {
	const mode = request.transport ?? 'auto';
	const run = async (withThinking: boolean): Promise<ChatResult> => {
		if (mode === 'requestUrl') {
			return chatViaRequestUrl(request, onDelta, withThinking);
		}
		let emitted = '';
		try {
			return await chatViaFetch(
				request,
				(delta, full) => {
					emitted = full;
					onDelta?.(delta, full);
				},
				withThinking,
			);
		} catch (error) {
			if (mode !== 'auto' || emitted !== '' || !isNetworkError(error)) throw error;
			console.warn('pickme：浏览器 fetch 被拦，改用 Obsidian requestUrl 重发', error);
			return chatViaRequestUrl(request, onDelta, withThinking);
		}
	};

	try {
		return await run(true);
	} catch (error) {
		// 通用 OpenAI 兼容接口不认 thinking 字段，去掉它再发一次，别让深度思考开关把请求打死
		if (!isThinkingParamError(error)) throw error;
		console.warn('pickme：接口不认 thinking 参数，去掉后重发一次', error);
		return run(false);
	}
}

/** 浏览器 fetch：唯一支持真流式的通道，但受 CORS 约束 */
async function chatViaFetch(
	request: ChatRequest,
	onDelta?: (delta: string, full: string) => void,
	withThinking = true,
): Promise<ChatResult> {
	const gate = combineSignal(request.signal, request.timeoutSec ?? 0);
	let response: Response;
	try {
		// 这里只能用浏览器 fetch：见 browserFetch 的说明（requestUrl 拿不到流式响应体，
		// 长回答/深度思考时界面会长时间空白）。requestUrl 是兜底通道，见本函数 catch 与 chat() 的 auto 分支。
		response = await browserFetch(joinUrl(request.baseUrl, '/chat/completions'), {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${request.apiKey}`,
			},
			body: buildPayload(request, request.stream, withThinking),
			signal: gate.signal,
		});
	} catch (error) {
		gate.cleanup();
		if (gate.timedOut()) {
			throw new Error(`请求超时（${request.timeoutSec} 秒），可在设置里调整`);
		}
		throw error;
	}

	if (!response.ok) {
		gate.cleanup();
		const detail = await response.text().catch(() => '');
		throw new Error(`接口返回 ${response.status}${detail ? `：${detail.slice(0, 300)}` : ''}`);
	}

	if (!request.stream || !response.body) {
		const data = (await response.json()) as {
			choices?: Array<{ message?: { content?: string; reasoning_content?: string }; finish_reason?: string }>;
			usage?: ChatResult['usage'];
		};
		gate.cleanup();
		const choice = data.choices?.[0];
		const text = choice?.message?.content ?? '';
		const reasoning = choice?.message?.reasoning_content ?? '';
		onDelta?.(text, text);
		return { text, usage: data.usage, reasoning, finishReason: choice?.finish_reason };
	}

	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = '';
	let full = '';
	let reasoning = '';
	let finishReason: string | undefined;
	while (true) {
		let chunk: ReadableStreamReadResult<Uint8Array>;
		try {
			chunk = await reader.read();
		} catch (error) {
			// 超时或用户中止：保留已完成的部分，由调用方决定怎么落盘
			gate.cleanup();
			if (gate.timedOut() || request.signal?.aborted) {
				return { text: full, aborted: true, reasoning, finishReason };
			}
			throw error;
		}
		const { done, value } = chunk;
		if (done) break;
		buffer += decoder.decode(value, { stream: true });
		const lines = buffer.split('\n');
		buffer = lines.pop() ?? '';
		for (const line of lines) {
			const trimmed = line.trim();
			if (!trimmed.startsWith('data:')) continue;
			const payload = trimmed.slice(5).trim();
			if (payload === '[DONE]') continue;
			try {
				const parsed = JSON.parse(payload) as {
					choices?: Array<{
						delta?: { content?: string; reasoning_content?: string };
						finish_reason?: string;
					}>;
				};
				const choice = parsed.choices?.[0];
				if (choice?.finish_reason) finishReason = choice.finish_reason;
				const thought = choice?.delta?.reasoning_content ?? '';
				if (thought) reasoning += thought;
				const delta = choice?.delta?.content ?? '';
				if (delta) {
					full += delta;
					onDelta?.(delta, full);
				}
			} catch {
				// 忽略无法解析的分片
			}
		}
	}
	gate.cleanup();
	return { text: full, reasoning, finishReason };
}

/**
 * Obsidian 主进程通道：不受 CORS 约束，代价是没有流式。
 * 内容一次性回来，按整段回填给界面。
 */
async function chatViaRequestUrl(
	request: ChatRequest,
	onDelta?: (delta: string, full: string) => void,
	withThinking = true,
): Promise<ChatResult> {
	const timeoutSec = request.timeoutSec ?? 0;
	let timedOut = false;
	let response: RequestUrlResponse;
	try {
		response = await withTimeout(
			requestUrl({
				url: joinUrl(request.baseUrl, '/chat/completions'),
				method: 'POST',
				contentType: 'application/json',
				headers: { Authorization: `Bearer ${request.apiKey}` },
				body: buildPayload(request, false, withThinking),
				throw: false,
			}),
			timeoutSec,
			request.signal,
			() => {
				timedOut = true;
			},
		);
	} catch (error) {
		if (timedOut) throw new Error(`请求超时（${timeoutSec} 秒），可在设置里调整`);
		if (request.signal?.aborted) return { text: '', aborted: true };
		throw error;
	}

	if (response.status >= 400) {
		const detail = (response.text ?? '').slice(0, 300);
		throw new Error(`接口返回 ${response.status}${detail ? `：${detail}` : ''}`);
	}

	let text = '';
	let reasoning = '';
	let finishReason: string | undefined;
	try {
		const data = (response.json ?? JSON.parse(response.text)) as {
			choices?: Array<{ message?: { content?: string; reasoning_content?: string }; finish_reason?: string }>;
		};
		const choice = data?.choices?.[0];
		text = choice?.message?.content ?? '';
		reasoning = choice?.message?.reasoning_content ?? '';
		finishReason = choice?.finish_reason;
	} catch {
		text = response.text ?? '';
	}
	onDelta?.(text, text);
	return { text, reasoning, finishReason };
}

/** 拉取接口上的模型列表，供设置页与侧边栏下拉使用 */
export async function listModels(
	baseUrl: string,
	apiKey: string,
	transport: ChatTransport = 'auto',
): Promise<string[]> {
	const parse = (raw: unknown): string[] => {
		const data = raw as { data?: Array<{ id?: string }> } | null;
		return (data?.data ?? [])
			.map((item) => item.id ?? '')
			.filter((id) => id !== '')
			.sort();
	};

	if (transport !== 'fetch') {
		try {
			const response = await requestUrl({
				url: joinUrl(baseUrl, '/models'),
				method: 'GET',
				headers: { Authorization: `Bearer ${apiKey}` },
				throw: false,
			});
			if (response.status >= 400) {
				throw new Error(`接口返回 ${response.status}`);
			}
			return parse(response.json ?? JSON.parse(response.text));
		} catch (error) {
			if (transport === 'requestUrl') throw error;
			console.warn('pickme：requestUrl 拉取模型失败，改用 fetch 再试一次', error);
		}
	}

	// requestUrl 上面已经试过；这里用 fetch 再试一次，覆盖「中转站只对浏览器请求放行」的情况
	const response = await browserFetch(joinUrl(baseUrl, '/models'), {
		headers: { Authorization: `Bearer ${apiKey}` },
	});
	if (!response.ok) {
		throw new Error(`接口返回 ${response.status}`);
	}
	return parse(await response.json());
}

export function buildSystemPrompt(withContext: boolean): string {
	// 跟随界面语言：英文界面下模型也用英文作答
	const base = t('你是一个中文技术助手，正在为阅读中的文档做批注。回答要具体、可核对，不要重复原文，不要编造原文里没有的信息。');
	return withContext ? `${base} ${t('用户会给出选区，可能还有上下文片段。')}` : base;
}
