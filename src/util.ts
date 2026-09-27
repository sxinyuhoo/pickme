import { App, normalizePath, TFile, TFolder, Vault } from 'obsidian';

/** ISO 时间戳，带本地时区偏移 */
export function nowIso(): string {
	const now = new Date();
	const offsetMinutes = -now.getTimezoneOffset();
	const sign = offsetMinutes >= 0 ? '+' : '-';
	const pad = (n: number) => String(Math.abs(n)).padStart(2, '0');
	return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(
		now.getMinutes(),
	)}:${pad(now.getSeconds())}${sign}${pad(Math.floor(offsetMinutes / 60))}:${pad(offsetMinutes % 60)}`;
}

export function normalizeDir(dir: string): string {
	return normalizePath(dir).replace(/^\/+|\/+$/g, '');
}

/** 逐级创建目录 */
export async function ensureFolder(app: App, path: string): Promise<TFolder | null> {
	const dir = normalizeDir(path);
	if (!dir) return app.vault.getRoot();
	const existing = app.vault.getAbstractFileByPath(dir);
	if (existing instanceof TFolder) return existing;
	const segments = dir.split('/');
	let current = '';
	for (const segment of segments) {
		current = current ? `${current}/${segment}` : segment;
		const found = app.vault.getAbstractFileByPath(current);
		if (found instanceof TFolder) continue;
		if (found instanceof TFile) {
			throw new Error(`${current} 已是文件，无法创建目录`);
		}
		await app.vault.createFolder(current);
	}
	const folder = app.vault.getAbstractFileByPath(dir);
	return folder instanceof TFolder ? folder : null;
}

/** 为文件路径创建其所在目录 */
export async function ensureParentFolder(app: App, filePath: string): Promise<void> {
	const parts = normalizePath(filePath).split('/');
	parts.pop();
	if (parts.length === 0) return;
	await ensureFolder(app, parts.join('/'));
}

export async function fileExists(vault: Vault, path: string): Promise<boolean> {
	return vault.adapter.exists(normalizePath(path));
}

export function toTFile(app: App, path: string): TFile | null {
	const file = app.vault.getAbstractFileByPath(normalizePath(path));
	return file instanceof TFile ? file : null;
}

/** 二进制转 base64，用于把区域截图作为图片输入送给模型 */
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
	const bytes = new Uint8Array(buffer);
	const chunk = 0x8000;
	let binary = '';
	for (let i = 0; i < bytes.length; i += chunk) {
		binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
	}
	return btoa(binary);
}

/** 把可能为空的字符串收敛为去除首尾空白的文本 */
export function textOf(value: unknown): string {
	return typeof value === 'string' ? value.trim() : '';
}
