import { App } from 'obsidian';
import type { PickmeSettings } from '../settings.ts';
import { DEFAULT_TEMPLATES, defaultTemplateFiles, parseTemplate } from '../core/template.ts';
import type { PickmeTemplate } from '../core/template.ts';
import { normalizeDir } from '../util.ts';
import { FileIO } from './io.ts';

/** 模板即 Markdown 文件，正文是提示词，frontmatter 覆盖模型参数 */
export class TemplateStore {
	private settings: () => PickmeSettings;
	readonly io: FileIO;

	constructor(app: App, settings: () => PickmeSettings) {
		this.settings = settings;
		this.io = new FileIO(app);
	}

	dir(): string {
		return normalizeDir(this.settings().templateDir);
	}

	/** 把内置模板写入模板目录，已存在的一律不覆盖（用户可能改过提示词） */
	async ensureDefaults(): Promise<number> {
		const dir = this.dir();
		if (!dir) return 0;
		await this.io.ensureFolder(dir);
		let created = 0;
		for (const template of defaultTemplateFiles(dir)) {
			if ((await this.io.readText(template.path)) !== null) continue;
			await this.io.writeText(template.path, template.content);
			created += 1;
		}
		return created;
	}

	/** 模板目录下全部模板的文件名（不含 .md），按名称排序 */
	async listAll(): Promise<string[]> {
		const dir = this.dir();
		if (!dir) return [];
		const files = await this.io.listFiles(dir);
		return files
			.filter((path) => path.endsWith('.md') && !path.slice(dir.length + 1).includes('/'))
			.map((path) => (path.split('/').pop() ?? path).replace(/\.md$/, ''))
			.sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
	}

	/** 提问面板用的列表：去掉用户在设置里隐藏掉的模板 */
	async list(): Promise<string[]> {
		const hidden = new Set(this.settings().hiddenTemplates ?? []);
		return (await this.listAll()).filter((name) => !hidden.has(name));
	}

	/** 内置模板的名字（顺序就是设置页里的排列顺序） */
	builtinNames(): string[] {
		return DEFAULT_TEMPLATES.map((template) => template.name);
	}

	/** 把模板名排成：内置的按内置顺序在前，自建的按名字跟在后面 */
	order(names: string[]): string[] {
		const builtin = this.builtinNames();
		return [...names].sort((a, b) => {
			const ai = builtin.indexOf(a);
			const bi = builtin.indexOf(b);
			if (ai >= 0 && bi >= 0) return ai - bi;
			if (ai >= 0) return -1;
			if (bi >= 0) return 1;
			return a.localeCompare(b, 'zh-Hans-CN');
		});
	}

	/** 删掉一个模板文件；返回是否真的删掉了 */
	async remove(name: string): Promise<boolean> {
		const dir = this.dir();
		const path = dir ? `${dir}/${name}.md` : `${name}.md`;
		if ((await this.io.readText(path)) === null) return false;
		await this.io.remove(path);
		return true;
	}

	async read(name: string): Promise<PickmeTemplate | null> {
		const dir = this.dir();
		const path = dir ? `${dir}/${name}.md` : `${name}.md`;
		const text = await this.io.readText(path);
		if (text === null) return null;
		return parseTemplate(name, text);
	}
}
