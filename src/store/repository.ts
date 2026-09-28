import { App, MarkdownView, Notice, TFile } from 'obsidian';
import type { PickmeSettings } from '../settings.ts';
import type { AnnotationDoc, AnnotationEntry, EntryMatch } from '../core/types.ts';
import { matchEntries, removeAnchors, scanAnchors } from '../core/anchor.ts';
import { fingerprint } from '../core/anchor.ts';
import {
	assetPath,
	isAnnotationFile,
	sidecarPath,
	sourcePathFromSidecar,
} from '../core/paths.ts';
import { parseAnnotationDoc, renderAnnotationDoc } from '../core/annotationDoc.ts';
import { normalizeDir, nowIso } from '../util.ts';
import { FileIO } from './io.ts';

/** 批注索引里的一篇源文档（侧边栏展示用） */
export interface IndexGroup {
	/** 源文档在库内的路径 */
	sourcePath: string;
	/** 文件名（不带 .md） */
	sourceName: string;
	entries: AnnotationEntry[];
	/** 批注文件最后更新时间 */
	updated: string;
}

export interface LoadedDoc {
	doc: AnnotationDoc;
	/** 批注文件路径，没有对应文件时为 null */
	filePath: string | null;
}

/**
 * 批注文件仓库：负责批注文件的读写、状态同步、迁移与索引。
 * 文件读写统一走 FileIO，因此批注目录既可以设在库内可见目录，也可以设在配置目录里。
 */
export class AnnotationRepository {
	private app: App;
	private settings: () => PickmeSettings;
	readonly io: FileIO;
	/** 批注文件写完之后回调一次，用来刷新索引笔记 */
	onChanged?: () => void;

	constructor(app: App, settings: () => PickmeSettings) {
		this.app = app;
		this.settings = settings;
		this.io = new FileIO(app);
	}

	dir(): string {
		return normalizeDir(this.settings().annotationDir);
	}

	tagName(): string {
		return this.settings().tagName;
	}

	async ensureDir(): Promise<void> {
		const dir = this.dir();
		if (dir) await this.io.ensureFolder(dir);
	}

	/** 源文档对应的批注文件路径 */
	sidecarPathOf(sourcePath: string): string {
		return sidecarPath(sourcePath, this.dir());
	}

	/** 区域截图的库内路径 */
	assetPathFor(sourcePath: string, entryIndex: number): string {
		return assetPath(this.sidecarPathOf(sourcePath), this.dir(), entryIndex);
	}

	async loadFor(sourceFile: TFile): Promise<LoadedDoc> {
		const path = this.sidecarPathOf(sourceFile.path);
		const sourceType: 'md' | 'pdf' = sourceFile.extension === 'pdf' ? 'pdf' : 'md';
		const text = await this.io.readText(path);
		if (text !== null) {
			const doc = parseAnnotationDoc(text, path);
			// 以真实源文件为准，frontmatter 只作兜底
			doc.sourcePath = sourceFile.path;
			doc.sourceType = sourceType;
			return { doc, filePath: path };
		}
		const now = nowIso();
		return {
			doc: {
				sourcePath: sourceFile.path,
				sourceType,
				selfPath: path,
				created: now,
				updated: now,
				entries: [],
			},
			filePath: null,
		};
	}

	/** 某个目录下的批注文件数，用于判断是否需要迁移 */
	async countFilesIn(dir: string): Promise<number> {
		const files = await this.io.listFiles(dir);
		return files.filter((path) => path.endsWith('.md')).length;
	}

	/** 按设置给还没有批注文件的文档补一个空文件 */
	async ensureDoc(sourceFile: TFile): Promise<AnnotationDoc> {
		const { doc, filePath } = await this.loadFor(sourceFile);
		if (!filePath) await this.save(doc);
		return doc;
	}

	async save(doc: AnnotationDoc): Promise<string> {
		await this.ensureDir();
		doc.updated = nowIso();
		await this.io.writeText(doc.selfPath, renderAnnotationDoc(doc));
		// 所有增删改都从这里落地，索引笔记在这里挂钩子就行
		this.onChanged?.();
		return doc.selfPath;
	}

	async addEntry(sourceFile: TFile, entry: AnnotationEntry): Promise<AnnotationDoc> {
		const { doc } = await this.loadFor(sourceFile);
		const index = doc.entries.findIndex((item) => item.id === entry.id);
		if (index >= 0) {
			doc.entries[index] = entry;
		} else {
			doc.entries.push(entry);
		}
		await this.save(doc);
		return doc;
	}

	async updateEntry(
		sourceFile: TFile,
		id: string,
		patch: Partial<AnnotationEntry>,
	): Promise<AnnotationDoc> {
		const { doc } = await this.loadFor(sourceFile);
		const entry = doc.entries.find((item) => item.id === id);
		if (entry) {
			Object.assign(entry, patch);
			await this.save(doc);
		}
		return doc;
	}

	/** 删除一条批注：同时清理源文档里的两个锚点标签 */
	async deleteEntry(sourceFile: TFile, id: string): Promise<AnnotationDoc> {
		const { doc, filePath } = await this.loadFor(sourceFile);
		const entry = doc.entries.find((item) => item.id === id);
		if (!entry) return doc;
		doc.entries = doc.entries.filter((item) => item.id !== id);

		if (entry.kind === 'text') {
			await this.app.vault.process(sourceFile, (text) => removeAnchors(text, id, this.tagName()));
		}
		if (entry.pdf?.image) {
			await this.io.remove(entry.pdf.image);
			// 最后一张图删掉后 _assets/<文档>.md/ 就空了，顺手收掉，别留空文件夹
			await this.io.pruneEmptyFolder(entry.pdf.image.split('/').slice(0, -1).join('/'));
		}

		if (doc.entries.length === 0 && filePath) {
			await this.io.remove(filePath);
		} else {
			await this.save(doc);
		}
		return doc;
	}

	/**
	 * 源文档的当前文本。
	 * 文档正开在编辑器里时用编辑器内容：刚插完锚点那会儿磁盘上还是旧内容，
	 * 直接读缓存会把新锚点误判成失效。
	 */
	async sourceTextOf(sourceFile: TFile): Promise<string> {
		for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
			const view = leaf.view;
			if (view instanceof MarkdownView && view.file?.path === sourceFile.path) {
				return view.editor.getValue();
			}
		}
		return await this.app.vault.cachedRead(sourceFile);
	}

	/** 重新扫描源文档，刷新每条批注的锚点状态与指纹 */
	async syncStatuses(sourceFile: TFile): Promise<AnnotationDoc> {
		const { doc, filePath } = await this.loadFor(sourceFile);
		if (!filePath || doc.entries.length === 0) return doc;
		const text = await this.sourceTextOf(sourceFile);
		const scan = scanAnchors(text, this.tagName());
		const matches = matchEntries(
			doc.entries.filter((entry) => entry.kind === 'text'),
			scan,
		);
		let changed = false;
		for (const entry of doc.entries) {
			if (entry.kind !== 'text') continue;
			const match: EntryMatch = matches.get(entry.id) ?? 'stale';
			const status: AnnotationEntry['status'] = match === 'ok' ? 'ok' : 'stale';
			if (entry.status !== status) {
				entry.status = status;
				changed = true;
			}
		}
		if (changed) await this.save(doc);
		return doc;
	}

	/** 把失效锚点按选区文本重新绑定到新的 id */
	async rebindEntry(sourceFile: TFile, id: string, newId: string): Promise<boolean> {
		const { doc } = await this.loadFor(sourceFile);
		const entry = doc.entries.find((item) => item.id === id);
		if (!entry) return false;
		entry.id = newId;
		entry.status = 'ok';
		await this.save(doc);
		return true;
	}

	/** 全部批注文件路径（不含模板与资源） */
	async annotationFiles(): Promise<string[]> {
		const dir = this.dir();
		if (!dir) return [];
		return (await this.annotationFilePaths()).filter((path) => isAnnotationFile(path, dir));
	}

	/** 目录下所有 Markdown 文件路径（含模板与资源） */
	private async annotationFilePaths(): Promise<string[]> {
		const dir = this.dir();
		if (!dir) return [];
		const files = await this.io.listFiles(dir);
		return files.filter((path) => path.endsWith('.md'));
	}

	/** 从批注文件路径反推源文档，用于索引 */
	sourcePathOf(sidecarPathValue: string, doc?: AnnotationDoc): string {
		if (doc?.sourcePath) return doc.sourcePath;
		return sourcePathFromSidecar(sidecarPathValue, this.dir());
	}

	/**
	 * 迁移批注目录：逐文件搬运，跨越「库内 ↔ 配置目录内」也能用；
	 * 搬完把批注里记的区域截图路径改写到新目录。
	 */
	async migrate(fromDir: string, toDir: string): Promise<number> {
		const from = normalizeDir(fromDir);
		const to = normalizeDir(toDir);
		if (!from || !to || from === to) return 0;
		const moved = await this.io.migrateDir(from, to);
		if (moved === 0) return 0;
		// 截图路径写在批注文件里，跟着目录一起改
		for (const path of await this.io.listFiles(to)) {
			if (!path.endsWith('.md')) continue;
			const text = await this.io.readText(path);
			if (text === null) continue;
			const doc = parseAnnotationDoc(text, path);
			let changed = false;
			for (const entry of doc.entries) {
				if (entry.pdf?.image?.startsWith(`${from}/`)) {
					entry.pdf.image = `${to}/${entry.pdf.image.slice(from.length + 1)}`;
					changed = true;
				}
			}
			if (changed) await this.io.writeText(path, renderAnnotationDoc(doc));
		}
		return moved;
	}

	/** 生成批注索引笔记 */
	/**
	 * 索引侧边栏的数据：逐篇源文档给出它的全部批注。
	 * 直接读批注文件（不解析生成的索引表），所以永远是最新的。
	 */
	async indexData(): Promise<IndexGroup[]> {
		const groups: IndexGroup[] = [];
		for (const path of await this.annotationFiles()) {
			const text = await this.io.readText(path);
			if (text === null) continue;
			const doc = parseAnnotationDoc(text, path);
			if (doc.entries.length === 0) continue;
			const sourcePath = this.sourcePathOf(path, doc);
			groups.push({
				sourcePath,
				sourceName: (sourcePath.split('/').pop() ?? sourcePath).replace(/\.md$/, ''),
				entries: doc.entries,
				updated: doc.updated ?? '',
			});
		}
		groups.sort((a, b) => (b.updated ?? '').localeCompare(a.updated ?? ''));
		return groups;
	}

	async buildIndex(indexPath: string): Promise<{ rows: number; path: string }> {
		const rows: string[] = [];
		for (const path of await this.annotationFiles()) {
			const text = await this.io.readText(path);
			if (text === null) continue;
			const doc = parseAnnotationDoc(text, path);
			const sourcePath = this.sourcePathOf(path, doc);
			const sourceName = (sourcePath.split('/').pop() ?? sourcePath).replace(/\.md$/, '');
			for (const entry of doc.entries) {
				const selection =
					entry.kind === 'pdf'
						? `第 ${entry.pdf?.page ?? '?'} 页区域`
						: shorten(entry.selection, 40);
				rows.push(
					`| [[${sourceName}]] | \`${entry.id}\` | ${selection} | ${entry.status === 'ok' ? '有效' : '失效'} | ${entry.qas.length} | ${entry.created || doc.updated} |`,
				);
			}
		}

		const header = [
			'| 源文档 | 锚点 | 选区 | 状态 | 提问数 | 创建 |',
			'| --- | --- | --- | --- | --- | --- |',
		];
		const body = [
			'---',
			'类型: pickme 批注索引',
			`更新: ${nowIso()}`,
			`批注条数: ${rows.length}`,
			'---',
			'',
			'# pickme 批注索引',
			'',
			'由插件生成，手动修改会在下次重建时被覆盖。',
			'',
			...header,
			...(rows.length > 0 ? rows : ['| 暂无批注 |  |  |  |  |  |']),
			'',
		].join('\n');

		if (!indexPath) {
			new Notice(`pickme：未设置索引路径，本次共 ${rows.length} 条批注`);
			return { rows: rows.length, path: '' };
		}
		await this.io.writeText(indexPath, body);
		return { rows: rows.length, path: indexPath };
	}

	/** 计算一条批注的选区指纹 */
	async fingerprintForSelection(sourceFile: TFile, selection: string): Promise<string> {
		const text = await this.sourceTextOf(sourceFile);
		const scan = scanAnchors(text, this.tagName());
		const found = scan.pairs.find((pair) => pair.text === selection);
		return fingerprint(found?.text ?? selection);
	}
}

function shorten(text: string, limit: number): string {
	const single = text.replace(/\s+/g, ' ').trim();
	if (single.length <= limit) return single;
	return `${single.slice(0, limit)}…`;
}
