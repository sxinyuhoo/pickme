/** 极简 YAML frontmatter 读写，只服务于本插件生成的固定结构 */

export interface ParsedFrontmatter {
	data: Record<string, string>;
	body: string;
}

const DELIM = '---';

export function parseFrontmatter(text: string): ParsedFrontmatter {
	if (!text.startsWith(DELIM)) {
		return { data: {}, body: text };
	}
	const end = text.indexOf(`\n${DELIM}`, DELIM.length);
	if (end === -1) {
		return { data: {}, body: text };
	}
	const raw = text.slice(DELIM.length, end);
	const body = text.slice(end + DELIM.length + 1).replace(/^\n/, '');
	const data: Record<string, string> = {};
	for (const line of raw.split('\n')) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#')) continue;
		const idx = trimmed.indexOf(':');
		if (idx === -1) continue;
		const key = trimmed.slice(0, idx).trim();
		let value = trimmed.slice(idx + 1).trim();
		if (
			(value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"))
		) {
			value = value.slice(1, -1);
		}
		data[key] = value;
	}
	return { data, body };
}

function quoteIfNeeded(value: string): string {
	if (value === '') return '""';
	const needQuote = /[:#\[\]{}",\n]/.test(value) || value !== value.trim();
	if (!needQuote) return value;
	return `"${value.replace(/"/g, '\\"')}"`;
}

export function stringifyFrontmatter(data: Record<string, string | number>, body: string): string {
	const lines = Object.entries(data).map(([key, value]) => {
		const text = typeof value === 'number' ? String(value) : quoteIfNeeded(value);
		return `${key}: ${text}`;
	});
	return `${DELIM}\n${lines.join('\n')}\n${DELIM}\n\n${body.replace(/^\n+/, '')}`;
}
