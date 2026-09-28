import { App, normalizePath, TFile } from 'obsidian';

/**
 * 批注文件会落在两类位置，两边的 API 完全不同：
 *
 * 1. 库索引内（例如 30-批注/…）：走 Vault API，文件进索引，能被 Dataview 与双链看到。
 * 2. 配置目录内（默认的 .obsidian/plugins/pickme/annotations）：Obsidian 不索引配置目录，
 *    真机实测 Vault API 在这里会直接抛
 *    `TypeError: Cannot read properties of null (reading 'path')`，
 *    而 vault.adapter 的读写、建目录、列目录都正常。
 *
 * 这一层按路径自动选路，上层（仓库、模板、截图）不用关心批注目录设在哪。
 */
export class FileIO {
	private app: App;
	/** 非索引目录里的图片没法用 getResourcePath，缓存 blob url 给缩略图用 */
	private urls = new Map<string, string>();

	constructor(app: App) {
		this.app = app;
	}

	configDir(): string {
		return normalizePath(this.app.vault.configDir);
	}

	/** 路径是否在库索引范围内 */
	isIndexed(path: string): boolean {
		const clean = normalizePath(path);
		const config = this.configDir();
		return clean !== config && !clean.startsWith(`${config}/`);
	}

	private fileOf(path: string): TFile | null {
		const found = this.app.vault.getAbstractFileByPath(normalizePath(path));
		return found instanceof TFile ? found : null;
	}

	async exists(path: string): Promise<boolean> {
		if (this.isIndexed(path) && this.fileOf(path)) return true;
		try {
			return await this.app.vault.adapter.exists(normalizePath(path));
		} catch {
			return false;
		}
	}

	async readText(path: string): Promise<string | null> {
		const indexed = this.isIndexed(path) ? this.fileOf(path) : null;
		if (indexed) return await this.app.vault.read(indexed);
		try {
			const clean = normalizePath(path);
			if (!(await this.app.vault.adapter.exists(clean))) return null;
			return await this.app.vault.adapter.read(clean);
		} catch {
			return null;
		}
	}

	async writeText(path: string, text: string): Promise<void> {
		const clean = normalizePath(path);
		const indexed = this.isIndexed(path) ? this.fileOf(path) : null;
		if (indexed) {
			await this.app.vault.modify(indexed, text);
			return;
		}
		await this.ensureParent(clean);
		if (this.isIndexed(path)) {
			try {
				await this.app.vault.create(clean, text);
				return;
			} catch {
				// 已存在或索引未就绪：退回 adapter 写，至少内容落盘
			}
		}
		await this.app.vault.adapter.write(clean, text);
	}

	async readBinary(path: string): Promise<ArrayBuffer | null> {
		const indexed = this.isIndexed(path) ? this.fileOf(path) : null;
		if (indexed) return await this.app.vault.readBinary(indexed);
		try {
			return await this.app.vault.adapter.readBinary(normalizePath(path));
		} catch {
			return null;
		}
	}

	async writeBinary(path: string, data: ArrayBuffer): Promise<void> {
		const clean = normalizePath(path);
		const indexed = this.isIndexed(path) ? this.fileOf(path) : null;
		if (indexed) {
			await this.app.vault.modifyBinary(indexed, data);
			return;
		}
		await this.ensureParent(clean);
		if (this.isIndexed(path)) {
			try {
				await this.app.vault.createBinary(clean, data);
				return;
			} catch {
				// 同上
			}
		}
		await this.app.vault.adapter.writeBinary(clean, data);
	}

	/** 删除文件：索引内的进系统回收站，配置目录里的直接删 */
	async remove(path: string): Promise<void> {
		const indexed = this.isIndexed(path) ? this.fileOf(path) : null;
		if (indexed) {
			await this.app.fileManager.trashFile(indexed);
			return;
		}
		try {
			await this.app.vault.adapter.remove(normalizePath(path));
		} catch {
			// 文件本来就不在，忽略
		}
	}

	/**
	 * 逐级建目录，两种路径都支持。
	 *
	 * 冷启动时插件比库索引先就绪，那一刻 getAbstractFileByPath 对已存在的目录
	 * 也返回 null，只看索引就会对着已存在的目录调 createFolder 并抛
	 * `Error: Folder already exists.`，整个 onload 挂掉。所以索引判定之外
	 * 还要兜住异常、并以 adapter 是否存在为准。
	 */
	async ensureFolder(dir: string): Promise<void> {
		const clean = normalizePath(dir).replace(/^\/+|\/+$/g, '');
		if (!clean) return;
		let current = '';
		for (const segment of clean.split('/')) {
			current = current ? `${current}/${segment}` : segment;
			if (await this.dirExists(current)) continue;
			try {
				if (this.isIndexed(current)) {
					try {
						await this.app.vault.createFolder(current);
					} catch {
						await this.app.vault.adapter.mkdir(current);
					}
				} else {
					await this.app.vault.adapter.mkdir(current);
				}
			} catch {
				// 已被别处建好，继续
			}
		}
	}

	/** 目录是否已存在：索引与 adapter 都问一遍，任一说有就算有 */
	private async dirExists(dir: string): Promise<boolean> {
		if (this.isIndexed(dir) && this.app.vault.getAbstractFileByPath(dir)) return true;
		try {
			return await this.app.vault.adapter.exists(normalizePath(dir));
		} catch {
			return false;
		}
	}

	async ensureParent(filePath: string): Promise<void> {
		const parts = normalizePath(filePath).split('/');
		parts.pop();
		if (parts.length === 0) return;
		await this.ensureFolder(parts.join('/'));
	}

	/** 递归列出目录下的全部文件路径 */
	async listFiles(dir: string): Promise<string[]> {
		const clean = normalizePath(dir).replace(/^\/+|\/+$/g, '');
		if (!clean) return [];
		const out: string[] = [];
		const walk = async (current: string): Promise<void> => {
			let listed: { files: string[]; folders: string[] };
			try {
				listed = await this.app.vault.adapter.list(current);
			} catch {
				return;
			}
			out.push(...listed.files.map((file) => normalizePath(file)));
			for (const folder of listed.folders) await walk(folder);
		};
		await walk(clean);
		return out;
	}

	/**
	 * 删掉一个已经空了的目录，只删这一层、绝不递归。
	 *
	 * 批注删除后配套的 `_assets/<文档名>.md/` 会空出来，不收拾就会在批注目录里
	 * 留下空文件夹（批注目录设到库内时用户能直接看到）。非空、不存在都由它去，
	 * 调用方不必先判断。
	 */
	async pruneEmptyFolder(dir: string): Promise<void> {
		const clean = normalizePath(dir).replace(/^\/+|\/+$/g, '');
		if (!clean) return;
		try {
			if (!(await this.dirExists(clean))) return;
			const listed = await this.app.vault.adapter.list(clean);
			if (listed.files.length > 0 || listed.folders.length > 0) return;
			// 第二个参数必须为 true：真实 Obsidian 的 adapter.rmdir 走 fs.rm 语义，
			// 对目录传 false 会抛 `EISDIR (is a directory)`——哪怕目录是空的，
			// 于是清理会被下面的 catch 静默吞掉（真机上撞到过）。空目录已在上一步确认。
			await this.app.vault.adapter.rmdir(clean, true);
		} catch {
			// 还有东西、或已被别处删掉，都不算错
		}
	}

	/** 图片可用的 url：索引内用库的资源路径，配置目录内用 blob */
	async resourceUrl(path: string): Promise<string | null> {
		if (this.isIndexed(path)) {
			try {
				return this.app.vault.adapter.getResourcePath(normalizePath(path));
			} catch {
				return null;
			}
		}
		const cached = this.urls.get(path);
		if (cached) return cached;
		const data = await this.readBinary(path);
		if (!data) return null;
		const url = URL.createObjectURL(new Blob([data]));
		this.urls.set(path, url);
		if (this.urls.size > 32) {
			for (const oldest of this.urls.keys()) {
				// Map 的键顺序就是插入顺序，这里只回收最早的一条
				const oldestUrl = this.urls.get(oldest);
				if (oldestUrl) URL.revokeObjectURL(oldestUrl);
				this.urls.delete(oldest);
				break;
			}
		}
		return url;
	}

	/**
	 * 把目录下的文件搬到另一个目录，返回搬动的文件数。
	 * 逐文件读写再删除，因此跨越「索引内 ↔ 配置目录内」也能用。
	 */
	async migrateDir(fromDir: string, toDir: string): Promise<number> {
		const from = normalizePath(fromDir).replace(/^\/+|\/+$/g, '');
		const to = normalizePath(toDir).replace(/^\/+|\/+$/g, '');
		if (!from || !to || from === to) return 0;
		const files = await this.listFiles(from);
		let moved = 0;
		for (const file of files) {
			const rel = file.slice(from.length + 1);
			if (!rel) continue;
			const target = `${to}/${rel}`;
			if (/\.(png|jpe?g|gif|webp|bmp|svg|avif)$/i.test(file)) {
				const data = await this.readBinary(file);
				if (!data) continue;
				await this.writeBinary(target, data);
			} else {
				const text = await this.readText(file);
				if (text === null) continue;
				await this.writeText(target, text);
			}
			await this.remove(file);
			moved += 1;
		}
		return moved;
	}
}
