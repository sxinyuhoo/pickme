import { parseFrontmatter } from './frontmatter.ts';

export interface TemplateConfig {
	/** pickme_model：覆盖本次运行的模型 */
	model: string;
	/** pickme_temperature */
	temperature: number | null;
	/** pickme_include_note：是否把整篇笔记正文一起送进去 */
	includeNote: boolean;
	/** pickme_vision：是否允许把区域截图作为图片输入 */
	vision: boolean;
	/** pickme_context：是否附带选区前后的上下文 */
	context: boolean;
}

export interface PickmeTemplate {
	name: string;
	prompt: string;
	config: TemplateConfig;
}

/** 规格定义的变量名 */
export const TEMPLATE_VARS = [
	'选区',
	'上下文',
	'笔记标题',
	'源路径',
	'页码',
	'区域图片',
	'已有批注',
	'提问',
] as const;

/** 变量别名，早期写法继续可用 */
export const TEMPLATE_VAR_ALIASES: Record<string, string> = {
	文档标题: '笔记标题',
	文档路径: '源路径',
};

const DEFAULT_CONFIG: TemplateConfig = {
	model: '',
	temperature: null,
	includeNote: false,
	vision: true,
	context: true,
};

interface DefaultTemplate {
	name: string;
	prompt: string;
	config?: Partial<TemplateConfig>;
}

/**
 * 内置模板。只留最常用的三个：解释、摘要、翻译。
 *
 * 每个模板都把「具体问题」当成可选段落：模板正文里写了 `{{提问}}`，
 * 用户填了就带上去、没填就把那一段整行去掉（见 renderPrompt），
 * 所以不需要用户事后自己去补占位符。
 */
export const DEFAULT_TEMPLATES: DefaultTemplate[] = [
	{
		name: '解释',
		prompt: [
			'用通俗的语言解释下面的内容：先给一句话结论，再点出它成立的前提条件，最后用一个类比帮助理解。',
			'',
			'选区：',
			'{{选区}}',
			'',
			'上下文：',
			'{{上下文}}',
			'',
			'除了解释，还要回答这个问题：{{提问}}',
		].join('\n'),
	},
	{
		name: '摘要',
		prompt: [
			'把下面的内容提炼成不超过 5 条要点，条目化输出，去掉修饰性表述，不要新增原文里没有的事实。',
			'',
			'选区：',
			'{{选区}}',
			'',
			'另外回答这个问题：{{提问}}',
		].join('\n'),
		config: { context: false },
	},
	{
		name: '翻译',
		prompt: [
			'把下面的内容翻译成{{提问}}，没写目标语言就中英互译。专业术语保留原样，并在括号里给出原文。',
			'',
			'选区：',
			'{{选区}}',
		].join('\n'),
		config: { context: false },
	},
];

/** 新建模板时的骨架：变量与可覆盖的参数都列在文件里，照着改就行 */
export const TEMPLATE_SKELETON = `---
pickme_model:
pickme_temperature: 0.3
pickme_include_note: false
pickme_vision: true
pickme_context: true
---

在这里写提示词。可用变量（写进正文会被替换）：

{{选区}}      选中的文字，或 PDF 框选区域里取到的文字
{{提问}}      你在面板里输入的问题
{{上下文}}    选区前后各一段正文
{{笔记标题}}  当前文档名
{{源路径}}    当前文档在库里的路径
{{页码}}      PDF 的页码
{{已有批注}}  这条批注之前的问答

{{选区}} 这类变量为空时，它所在的那一行会被整行去掉，
所以可以放心写「另外回答这个问题：{{提问}}」这种可选段落。

上面 frontmatter 里留空或删掉的项，就跟随设置里的默认值。
文件名就是模板名，会出现在提问面板的下拉里。
`;

function renderTemplateFile(template: DefaultTemplate): string {
	const config = { ...DEFAULT_CONFIG, ...(template.config ?? {}) };
	const lines = [
		'---',
		`pickme_model: ${config.model}`,
		`pickme_temperature: ${config.temperature === null ? '' : config.temperature}`,
		`pickme_include_note: ${config.includeNote}`,
		`pickme_vision: ${config.vision}`,
		`pickme_context: ${config.context}`,
		'---',
		'',
		template.prompt,
		'',
	];
	return lines.join('\n');
}

export function defaultTemplateFiles(dir: string): Array<{ path: string; content: string }> {
	const d = dir.replace(/^\/+|\/+$/g, '');
	return DEFAULT_TEMPLATES.map((template) => ({
		path: d ? `${d}/${template.name}.md` : `${template.name}.md`,
		content: renderTemplateFile(template),
	}));
}

function pick(data: Record<string, string>, keys: string[]): string | null {
	for (const key of keys) {
		const value = data[key];
		if (value !== undefined && value !== '') return value;
	}
	return null;
}

function toBoolean(value: string | null, fallback: boolean): boolean {
	if (value === null) return fallback;
	return !['false', 'no', '0', '否'].includes(value.trim().toLowerCase());
}

/**
 * 解析模板文件：正文是提示词，frontmatter 用 ASCII 键加 pickme_ 前缀覆盖配置。
 * 早期用中文键写的模板继续可读。
 */
export function parseTemplate(name: string, text: string): PickmeTemplate {
	const { data, body } = parseFrontmatter(text);
	const model = pick(data, ['pickme_model', 'pickme_模型']);
	const temperature = pick(data, ['pickme_temperature', 'pickme_温度']);
	return {
		name,
		prompt: body.trim(),
		config: {
			model: model ?? DEFAULT_CONFIG.model,
			temperature: temperature === null ? DEFAULT_CONFIG.temperature : Number(temperature),
			includeNote: toBoolean(
				pick(data, ['pickme_include_note', 'pickme_带全文']),
				DEFAULT_CONFIG.includeNote,
			),
			vision: toBoolean(pick(data, ['pickme_vision']), DEFAULT_CONFIG.vision),
			context: toBoolean(pick(data, ['pickme_context', 'pickme_带上下文']), DEFAULT_CONFIG.context),
		},
	};
}

/**
 * 提示词变量替换。
 *
 * 空值的占位符会把整行留成一个空标签（「具体问题：」）或一个空行——这种行直接去掉，
 * 模板里就能放心写「有就答、没有就跳过」的段落，不必让用户自己删占位符。
 * 未知变量保持原样；别名一并支持。
 */
export function renderPrompt(prompt: string, vars: Record<string, string>): string {
	const lookup: Record<string, string> = { ...vars };
	for (const [alias, target] of Object.entries(TEMPLATE_VAR_ALIASES)) {
		if (!(alias in lookup) && target in vars) lookup[alias] = vars[target];
	}
	const placeholder = /\{\{\s*([^}\s]+)\s*\}\}/g;
	const lines: string[] = [];
	for (const line of prompt.split('\n')) {
		const hasPlaceholder = /\{\{\s*[^}\s]+\s*\}\}/.test(line);
		const filled = line.replace(placeholder, (whole, key: string) =>
			key in lookup ? lookup[key] : whole,
		);
		if (hasPlaceholder) {
			const trimmed = filled.trim();
			// 整行只剩一个空标签、或者只剩「标签：」这种引导词，就去掉这一行
			if (trimmed === '' || /^[^\s:：]{0,12}[:：]$/.test(trimmed)) continue;
		}
		lines.push(filled);
	}
	return lines.join('\n');
}

/** 只保留选区里可读的文本，作为模型的默认输入 */
export function trimSelection(text: string, limit: number): string {
	const normalized = text.trim();
	if (limit <= 0 || normalized.length <= limit) return normalized;
	return `${normalized.slice(0, limit)}\n……（选区过长已截断）`;
}
