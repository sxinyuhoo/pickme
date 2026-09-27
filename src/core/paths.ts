/** 批注文件与资源在库内的路径换算 */

export function normalizeDir(dir: string): string {
	return dir.replace(/^\/+|\/+$/g, '');
}

function normalizePath(path: string): string {
	return path.replace(/^\/+/, '');
}

/** 源文件名换算为批注文件名：Markdown 源同名，其他源在原名后加 .md */
export function sidecarName(sourceName: string): string {
	return sourceName.endsWith('.md') ? sourceName : `${sourceName}.md`;
}

/** 已知的非 Markdown 源类型，用于把批注文件名还原成源文件名 */
const KNOWN_SOURCE_EXTENSIONS = [
	'pdf', 'docx', 'doc', 'txt', 'rtf', 'epub', 'html', 'htm', 'pptx', 'ppt',
	'xlsx', 'csv', 'canvas', 'djvu', 'mobi', 'azw3',
];

/**
 * 批注文件名还原为源文件名。
 * 这只是没有 frontmatter 时的兜底：权威映射是批注文件里的「源路径」字段。
 * 判断依据是白名单里的源类型后缀，所以 论文v1.0.md 这类名字不会被误剥。
 */
export function sourceNameFromSidecar(sidecar: string): string {
	if (!sidecar.endsWith('.md')) return sidecar;
	const base = sidecar.slice(0, -3);
	const ext = base.split('.').pop()?.toLowerCase() ?? '';
	return KNOWN_SOURCE_EXTENSIONS.includes(ext) ? base : sidecar;
}

/** 源文档路径换算为批注文件路径，目录结构镜像源文档 */
export function sidecarPath(sourcePath: string, dir: string): string {
	const d = normalizeDir(dir);
	const rel = normalizePath(sourcePath);
	const parts = rel.split('/');
	const name = sidecarName(parts.pop() ?? rel);
	const prefix = parts.length > 0 ? `${parts.join('/')}/` : '';
	return d ? `${d}/${prefix}${name}` : `${prefix}${name}`;
}

/** 批注文件路径还原为源文档路径 */
export function sourcePathFromSidecar(sidecarPathFull: string, dir: string): string {
	const d = normalizeDir(dir);
	let rel = normalizePath(sidecarPathFull);
	if (d && (rel === d || rel.startsWith(`${d}/`))) {
		rel = rel === d ? '' : rel.slice(d.length + 1);
	}
	const parts = rel.split('/');
	const name = sourceNameFromSidecar(parts.pop() ?? rel);
	return [...parts, name].filter(Boolean).join('/');
}

/** 批注目录里属于插件自己的内部目录（区域截图、模板），其余都算批注文件 */
export const INTERNAL_ANNOTATION_DIRS = ['_assets', '_模板'];

/**
 * 判断路径是否位于批注目录内，且不是插件自己的内部目录（区域截图、模板）。
 * 只看目录名：文件名以 _ 开头不再特殊对待——用户把文档命名成 _draft.md 时，
 * 它的批注同样应该出现在索引与统计里。
 */
export function isAnnotationFile(path: string, dir: string): boolean {
	const d = normalizeDir(dir);
	const rel = normalizePath(path);
	if (!d || !rel.startsWith(`${d}/`)) return false;
	const rest = rel.slice(d.length + 1);
	if (!rest.endsWith('.md')) return false;
	const folders = rest.split('/').slice(0, -1);
	return !folders.some((folder) => INTERNAL_ANNOTATION_DIRS.includes(folder));
}

/** 区域截图等资源文件的路径 */
export function assetPath(sidecarPathFull: string, dir: string, entryIndex: number): string {
	const d = normalizeDir(dir);
	const rel = normalizePath(sidecarPathFull);
	const rest = d && rel.startsWith(`${d}/`) ? rel.slice(d.length + 1) : rel;
	return `${d}/_assets/${rest}/${entryIndex}.png`;
}
