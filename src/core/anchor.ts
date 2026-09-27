import type { AnchorPair, EntryLike, EntryMatch, ScanResult } from './types.ts';

/** 默认锚点标签名，可在设置里改 */
export const DEFAULT_TAG = 'pickme';
/** 锚点 id 长度 */
export const ID_LENGTH = 6;
const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** 生成一个锚点 id，随机源的默认值是 Math.random，测试时可注入 */
export function newAnchorId(rand: () => number = Math.random): string {
	let out = '';
	for (let i = 0; i < ID_LENGTH; i++) {
		out += ID_ALPHABET[Math.floor(rand() * ID_ALPHABET.length)];
	}
	return out;
}

export function escapeRegExp(input: string): string {
	return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 生成成对的空标签，起点与终点使用同一个 id */
export function anchorTag(id: string, tag: string = DEFAULT_TAG): string {
	return `<${tag} id="${id}"></${tag}>`;
}

/** 匹配合法锚点标签的正则 */
export function anchorRegExp(tag: string = DEFAULT_TAG): RegExp {
	const t = escapeRegExp(tag);
	return new RegExp(`<${t}\\s+id="([a-z0-9]{${ID_LENGTH}})"\\s*></${t}>`, 'g');
}

/** 匹配任何形态的锚点标签（含不合法写法），用于统计损坏标签 */
export function looseAnchorRegExp(tag: string = DEFAULT_TAG): RegExp {
	const t = escapeRegExp(tag);
	return new RegExp(`<${t}\\b[^>]*></${t}>`, 'gi');
}

/**
 * 在选区首尾各插入一个带 id 的空标签。
 * 选区文字本身不被包裹，格式不受影响。
 */
export function insertAnchors(
	text: string,
	from: number,
	to: number,
	id: string,
	tag: string = DEFAULT_TAG,
): string {
	if (!Number.isInteger(from) || !Number.isInteger(to)) {
		throw new Error('选区范围必须是整数偏移');
	}
	if (from < 0 || to > text.length || from >= to) {
		throw new Error('选区范围无效');
	}
	const pair = anchorTag(id, tag);
	return text.slice(0, from) + pair + text.slice(from, to) + pair + text.slice(to);
}

/** 移除指定 id 的两个标签 */
export function removeAnchors(text: string, id: string, tag: string = DEFAULT_TAG): string {
	const re = new RegExp(
		`<${escapeRegExp(tag)}\\s+id="${id}"\\s*></${escapeRegExp(tag)}>`,
		'g',
	);
	return text.replace(re, '');
}

/** 把文本里所有锚点标签去掉，用于导出或纯文本比对 */
export function stripAnchors(text: string, tag: string = DEFAULT_TAG): string {
	return text.replace(looseAnchorRegExp(tag), '');
}

/**
 * 扫描文本里的全部锚点，按 id 配对。
 * 同一个 id 恰好两个标签时构成一个区间，多一个少一个都记入 broken。
 */
export function scanAnchors(text: string, tag: string = DEFAULT_TAG): ScanResult {
	const groups = new Map<string, Array<{ start: number; end: number }>>();
	const re = anchorRegExp(tag);
	let match: RegExpExecArray | null;
	while ((match = re.exec(text)) !== null) {
		const id = match[1];
		const list = groups.get(id) ?? [];
		list.push({ start: match.index, end: match.index + match[0].length });
		groups.set(id, list);
	}

	const pairs: AnchorPair[] = [];
	const broken: string[] = [];
	for (const [id, list] of groups) {
		if (list.length !== 2) {
			broken.push(id);
			continue;
		}
		const [head, tail] = list;
		pairs.push({ id, start: head.end, end: tail.start, text: text.slice(head.end, tail.start) });
	}
	pairs.sort((a, b) => a.start - b.start);

	const total = [...text.matchAll(looseAnchorRegExp(tag))].length;
	const malformed = Math.max(0, total - (pairs.length * 2 + broken.length * 2));

	return { pairs, malformed, broken };
}

/** 选区文本指纹，用于选区被小幅修改后的定位 */
export function fingerprint(text: string): string {
	let hash = 5381;
	const normalized = text.replace(/\s+/g, ' ').trim();
	for (let i = 0; i < normalized.length; i++) {
		hash = ((hash * 33) ^ normalized.charCodeAt(i)) >>> 0;
	}
	return hash.toString(16).padStart(8, '0');
}

/**
 * 用扫描结果判定每个批注条目的锚点状态。
 * ok 表示 id 与选区都对得上，rebind 表示靠选区文本找到了新位置，stale 表示找不到。
 */
export function matchEntries(
	entries: EntryLike[],
	scan: ScanResult,
): Map<string, EntryMatch> {
	const byId = new Map(scan.pairs.map((pair) => [pair.id, pair] as const));
	const result = new Map<string, EntryMatch>();

	for (const entry of entries) {
		const pair = byId.get(entry.id);
		if (pair) {
			const same = normalize(pair.text) === normalize(entry.selection);
			result.set(entry.id, same ? 'ok' : 'rebind');
			continue;
		}
		const candidates = scan.pairs.filter((p) => normalize(p.text) === normalize(entry.selection));
		result.set(entry.id, candidates.length === 1 ? 'rebind' : 'stale');
	}
	return result;
}

function normalize(text: string): string {
	return text.replace(/\s+/g, ' ').trim();
}
