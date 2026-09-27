// 把 pdf.js 的 CMap 与标准字体内联成 base64，编进 main.js。
//
// 为什么这么做：Obsidian 与 BRAT 安装插件时只会下载 release 里的
// main.js / manifest.json / styles.css，独立的资源文件没有分发通道；
// 缺了 CMap，未嵌入字体的中文 PDF 会渲染失败。
//
// 资源直接从 devDependency 的 pdfjs-dist 里取，和打包进产物的 pdf.js 版本天然一致，
// 仓库里不需要存这些二进制文件。
//
//   node scripts/inline-pdf-assets.mjs
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const source = path.join(root, 'node_modules', 'pdfjs-dist');
const outFile = path.join(root, 'src', 'generated', 'pdfAssets.ts');

if (!fs.existsSync(source)) {
	console.error('找不到 node_modules/pdfjs-dist，请先 npm install');
	process.exit(1);
}

const version = JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8')).version;

/** 读一个目录下的文件，返回「键 → base64」的映射，键排序保证产物可复现 */
function collect(dir, suffix) {
	if (!fs.existsSync(dir)) {
		console.error(`找不到 ${dir}`);
		process.exit(1);
	}
	const entries = fs
		.readdirSync(dir)
		.filter((name) => (suffix ? name.endsWith(suffix) : true))
		.sort();
	const map = {};
	for (const name of entries) {
		const key = suffix ? name.slice(0, -suffix.length) : name;
		map[key] = fs.readFileSync(path.join(dir, name)).toString('base64');
	}
	return map;
}

const cmaps = collect(path.join(source, 'cmaps'), '.bcmap');
const fonts = collect(path.join(source, 'standard_fonts'), null);

const render = (map) =>
	Object.entries(map)
		.map(([key, value]) => `\t${JSON.stringify(key)}: '${value}',`)
		.join('\n');

const contents = `// 本文件由 scripts/inline-pdf-assets.mjs 生成，不要手改。
// 来源：pdfjs-dist@${version}（Apache-2.0），见 README 的授权说明。
// CMap ${Object.keys(cmaps).length} 个、标准字体 ${Object.keys(fonts).length} 个，
// 运行时按需解码，不会一次性展开成字节数组。

export const PDF_ASSETS_SOURCE = 'pdfjs-dist@${version}';

export const CMAP_COUNT = ${Object.keys(cmaps).length};
export const STANDARD_FONT_COUNT = ${Object.keys(fonts).length};

/** 键是不带 .bcmap 后缀的 CMap 名，值是 base64 */
export const CMAP_BASE64: Record<string, string> = {
${render(cmaps)}
};

/** 键是带扩展名的字体文件名，值是 base64 */
export const STANDARD_FONT_BASE64: Record<string, string> = {
${render(fonts)}
};
`;

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, contents);

const kb = Math.round(fs.statSync(outFile).size / 1024);
console.log(
	`已内联 pdfjs-dist@${version}：CMap ${Object.keys(cmaps).length} 个、标准字体 ${Object.keys(fonts).length} 个 → src/generated/pdfAssets.ts（${kb} KB）`,
);
