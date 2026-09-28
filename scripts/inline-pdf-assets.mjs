// 把 pdf.js 的 CMap 与标准字体内联进 main.js。
//
// 为什么这么做：Obsidian 与 BRAT 安装插件时只会下载 release 里的
// main.js / manifest.json / styles.css，独立的资源文件没有分发通道；
// 缺了 CMap，未嵌入字体的中文 PDF 会渲染失败。
//
// 为什么是「拼接 + 整体 gzip + base64」：
//   .bcmap 是 pdf.js 自己的打包格式（仅有简单转义，没有熵编码），逐文件 base64 之后再逐个 gzip
//   只能省一点；把所有文件拼成一个流再 gzip，跨文件重复的码表能被同一个 32KB 窗口吃掉，
//   体积更小，而且运行时只解压一次、按偏移切片。main.js 因此小一截，
//   插件市场下载/安装时更不容易被网络中断打断。
//
// 资源直接从 devDependency 的 pdfjs-dist 里取，和打包进产物的 pdf.js 版本天然一致，
// 仓库里不需要存这些二进制文件。
//
//   node scripts/inline-pdf-assets.mjs
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const root = path.resolve(import.meta.dirname, '..');
const source = path.join(root, 'node_modules', 'pdfjs-dist');
const outFile = path.join(root, 'src', 'generated', 'pdfAssets.ts');

if (!fs.existsSync(source)) {
	console.error('找不到 node_modules/pdfjs-dist，请先 npm install');
	process.exit(1);
}

const version = JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8')).version;

/** 读一个目录下的文件，按文件名排序拼成一条流，并记录「键 → [偏移, 长度]」 */
function pack(dir, suffix) {
	if (!fs.existsSync(dir)) {
		console.error(`找不到 ${dir}`);
		process.exit(1);
	}
	const entries = fs
		.readdirSync(dir)
		.filter((name) => (suffix ? name.endsWith(suffix) : true))
		.sort();
	const chunks = [];
	const index = {};
	let offset = 0;
	for (const name of entries) {
		const key = suffix ? name.slice(0, -suffix.length) : name;
		const data = fs.readFileSync(path.join(dir, name));
		chunks.push(data);
		index[key] = [offset, data.length];
		offset += data.length;
	}
	const raw = Buffer.concat(chunks);
	// gzip 头的 MTIME 固定 0（zlib 默认），OS 字节再统一成 3（Unix）：
	// 否则 macOS 写 0x13、Linux 写 0x03，同一份源码在两台机器上会产出不同字节，
	// 「构建可复现」这条就形同虚设。除这个头字节外，deflate 部分由 zlib 版本决定。
	const gz = zlib.gzipSync(raw, { level: 9 });
	gz[9] = 3;
	return { index, base64: gz.toString('base64'), rawSize: raw.length, gzipSize: gz.length };
}

const cmaps = pack(path.join(source, 'cmaps'), '.bcmap');
const fonts = pack(path.join(source, 'standard_fonts'), null);

const renderIndex = (index) =>
	Object.entries(index)
		.map(([key, [start, length]]) => `\t${JSON.stringify(key)}: [${start}, ${length}],`)
		.join('\n');

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(2)} MB`;

const contents = `// 本文件由 scripts/inline-pdf-assets.mjs 生成，不要手改。
// 来源：pdfjs-dist@${version}（Apache-2.0），见 README 的授权说明。
// CMap ${Object.keys(cmaps.index).length} 个、标准字体 ${Object.keys(fonts.index).length} 个；
// 每个资源都有原始字节、整体 gzip 后 base64 的整包，以及「键 → [偏移, 长度]」索引。
// 运行时解压一次整包（惰性，首次用到才做），再按索引切片，不会把资源一次性展开成很多小数组。

export const PDF_ASSETS_SOURCE = 'pdfjs-dist@${version}';

export const CMAP_COUNT = ${Object.keys(cmaps.index).length};
export const STANDARD_FONT_COUNT = ${Object.keys(fonts.index).length};

/** 所有 .bcmap 拼接后整体 gzip，再 base64 */
export const CMAP_PACK_BASE64 =
	'${cmaps.base64}';

/** 键是不带 .bcmap 后缀的 CMap 名，值是解压后在整包里的 [起始偏移, 长度] */
export const CMAP_INDEX: Record<string, [number, number]> = {
${renderIndex(cmaps.index)}
};

/** 所有标准字体拼接后整体 gzip，再 base64 */
export const STANDARD_FONT_PACK_BASE64 =
	'${fonts.base64}';

/** 键是带扩展名的字体文件名，值是解压后在整包里的 [起始偏移, 长度] */
export const STANDARD_FONT_INDEX: Record<string, [number, number]> = {
${renderIndex(fonts.index)}
};
`;

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, contents);

const kb = Math.round(fs.statSync(outFile).size / 1024);
console.log(
	`已内联 pdfjs-dist@${version}：` +
		`CMap ${Object.keys(cmaps.index).length} 个（${mb(cmaps.rawSize)} → gzip ${mb(cmaps.gzipSize)}）、` +
		`标准字体 ${Object.keys(fonts.index).length} 个（${mb(fonts.rawSize)} → gzip ${mb(fonts.gzipSize)}）` +
		` → src/generated/pdfAssets.ts（${kb} KB）`,
);
