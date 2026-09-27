import type { AnnotationDoc, AnnotationEntry, PdfAnchorInfo, QA } from './types.ts';
import { parseFrontmatter, stringifyFrontmatter } from './frontmatter.ts';

const ENTRY_HEAD = '## 锚点 ';
const STATUS_OK = '有效';
const STATUS_STALE = '失效';

function entryStatusLabel(entry: AnnotationEntry): string {
	return entry.status === 'ok' ? STATUS_OK : STATUS_STALE;
}

/** 单条批注渲染为 Markdown 片段 */
export function renderEntry(entry: AnnotationEntry): string {
	const lines: string[] = [`${ENTRY_HEAD}${entry.id}`, ''];
	const kind = entry.kind === 'pdf' ? 'PDF 区域' : '文本';
	lines.push(`- 类型：${kind}`);
	if (entry.kind === 'text') {
		lines.push(`- 选区：${entry.selection}`);
	}
	lines.push(`- 锚点 id：${entry.id}`);
	// 兜底：字段缺失时宁可不写，也不要在文件里留下 undefined 这种字面量
	lines.push(`- 定位指纹：${entry.fingerprint ?? ''}`);
	lines.push(`- 状态：${entryStatusLabel(entry)}`);
	lines.push(`- 创建：${entry.created ?? ''}`);
	if (entry.pdf) {
		const pdf = entry.pdf;
		lines.push(`- 页码：${pdf.page}`);
		lines.push(`- 页面尺寸：${pdf.pageSize[0]}x${pdf.pageSize[1]}`);
		lines.push(`- 矩形：${pdf.rect.join(',')}`);
		lines.push(`- 归一化矩形：${pdf.normRect.map((n) => n.toFixed(4)).join(',')}`);
		if (pdf.hitText) lines.push(`- 命中文本：${pdf.hitText}`);
		if (pdf.image) lines.push('', `![[${pdf.image}]]`);
	}

	entry.qas.forEach((qa, index) => {
		lines.push('');
		if (index === 0) {
			lines.push('### 提问', '', qa.question);
			lines.push('', '### 模板', '', qa.template || '（直接提问）');
			lines.push('', '### 回答', '', qa.answer);
		} else {
			lines.push(`### 追问 ${index}`, '', `问：${qa.question}`, `答：${qa.answer}`);
		}
	});
	lines.push('');
	return lines.join('\n');
}

/** 整个批注文件渲染为 Markdown */
export function renderAnnotationDoc(doc: AnnotationDoc): string {
	const sourceName = doc.sourcePath.split('/').pop() ?? doc.sourcePath;
	const link = sourceName.replace(/\.md$/, '');
	const frontmatter: Record<string, string | number> = {
		类型: 'pickme 批注',
		源文档: `[[${link}]]`,
		源路径: doc.sourcePath,
		源类型: doc.sourceType === 'pdf' ? 'pdf' : 'markdown',
		批注版本: 1,
		创建: doc.created,
		更新: doc.updated,
		批注条数: doc.entries.length,
	};
	const body = [`源文档：[[${link}]]`, '', ...doc.entries.map((entry) => renderEntry(entry))].join('\n');
	return stringifyFrontmatter(frontmatter, body);
}

interface KVs {
	values: Map<string, string>;
	sections: Map<string, string[]>;
	/** 小节标题之前的正文行，PDF 区域截图就放在这里 */
	head: string[];
}

function splitBlocks(body: string): string[] {
	const blocks: string[] = [];
	let current: string[] | null = null;
	for (const line of body.split('\n')) {
		if (line.startsWith(ENTRY_HEAD)) {
			if (current) blocks.push(current.join('\n'));
			current = [line];
			continue;
		}
		if (current) current.push(line);
	}
	if (current) blocks.push(current.join('\n'));
	return blocks;
}

function parseBlock(block: string): KVs {
	const values = new Map<string, string>();
	const sections = new Map<string, string[]>();
	const head: string[] = [];
	let currentSection: string | null = null;

	for (const rawLine of block.split('\n')) {
		const line = rawLine.trimEnd();
		if (line.startsWith('### ')) {
			currentSection = line.slice(4).trim();
			sections.set(currentSection, []);
			continue;
		}
		if (currentSection) {
			sections.get(currentSection)?.push(line);
			continue;
		}
		head.push(line);
		const bullet = line.match(/^-\s*([^：]+)：(.*)$/);
		if (bullet) values.set(bullet[1].trim(), bullet[2].trim());
	}
	return { values, sections, head };
}

function sectionText(sections: Map<string, string[]>, name: string): string {
	const lines = sections.get(name);
	if (!lines) return '';
	return lines.join('\n').trim();
}

/** 解析批注文件，容错优先：解析不了的条目跳过而不是抛错 */
export function parseAnnotationDoc(text: string, selfPath: string): AnnotationDoc {
	const { data, body } = parseFrontmatter(text);
	const sourcePath = data['源路径'] ?? '';
	const sourceTypeText = data['源类型'] ?? 'markdown';
	const entries: AnnotationEntry[] = [];

	for (const block of splitBlocks(body)) {
		const { values, sections, head } = parseBlock(block);
		const id = block.split('\n')[0].slice(ENTRY_HEAD.length).trim();
		if (!id) continue;
		const kind = values.get('类型') === 'PDF 区域' ? 'pdf' : 'text';
		const entry: AnnotationEntry = {
			id,
			kind,
			selection: values.get('选区') ?? '',
			fingerprint: values.get('定位指纹') ?? '',
			status: values.get('状态') === STATUS_STALE ? 'stale' : 'ok',
			created: values.get('创建') ?? '',
			qas: [],
		};
		if (kind === 'pdf') {
			entry.pdf = parsePdfInfo(values, head);
		}

		const question = sectionText(sections, '提问');
		const template = sectionText(sections, '模板');
		const answer = sectionText(sections, '回答');
		if (question || answer) {
			entry.qas.push({
				question,
				template: template === '（直接提问）' ? '' : template,
				answer,
				created: entry.created,
			});
		}
		for (const [name, lines] of sections) {
			const match = name.match(/^追问\s*(\d+)$/);
			if (!match) continue;
			const text = lines.join('\n').trim();
			const q = text.match(/问：([\s\S]*?)(?:\n答：|$)/);
			const a = text.match(/答：([\s\S]*)$/);
			entry.qas.push({
				question: q ? q[1].trim() : '',
				template: '',
				answer: a ? a[1].trim() : '',
				created: entry.created,
			});
		}
		entries.push(entry);
	}

	return {
		sourcePath,
		sourceType: sourceTypeText === 'pdf' ? 'pdf' : 'md',
		selfPath,
		created: data['创建'] ?? '',
		updated: data['更新'] ?? '',
		entries,
	};
}

function parsePdfInfo(values: Map<string, string>, head: string[]): PdfAnchorInfo {
	const size = (values.get('页面尺寸') ?? '').split('x').map((n) => Number(n));
	const rect = (values.get('矩形') ?? '').split(',').map((n) => Number(n));
	const norm = (values.get('归一化矩形') ?? '').split(',').map((n) => Number(n));
	const image = head.join('\n').match(/!\[\[([^\]]+)\]\]/)?.[1] ?? '';
	return {
		page: Number(values.get('页码') ?? 1),
		pageSize: [size[0] || 0, size[1] || 0],
		rect: [rect[0] || 0, rect[1] || 0, rect[2] || 0, rect[3] || 0],
		normRect: [norm[0] || 0, norm[1] || 0, norm[2] || 0, norm[3] || 0],
		hitText: values.get('命中文本') ?? '',
		image,
	};
}

export function countQAs(entries: AnnotationEntry[]): number {
	return entries.reduce((sum: number, entry) => sum + entry.qas.length, 0);
}

export type { QA };
