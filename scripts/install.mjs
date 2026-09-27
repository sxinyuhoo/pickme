// 把插件安装到指定库：默认软链（开发用），--copy 则复制产物
//
//   node scripts/install.mjs "/path/to/vault"          软链整个项目
//   node scripts/install.mjs "/path/to/vault" --copy   只复制 main.js 等产物
import fs from 'node:fs';
import path from 'node:path';

const PLUGIN_ID = 'pickme';
const root = path.resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const copyMode = args.includes('--copy');
const vaultArg = args.find((arg) => !arg.startsWith('--'));

if (!vaultArg) {
	console.error('用法：node scripts/install.mjs "<vault 路径>" [--copy]');
	process.exit(1);
}
const vault = path.resolve(vaultArg);
if (!fs.existsSync(path.join(vault, '.obsidian'))) {
	console.error(`不是 Obsidian 库：${vault}（找不到 .obsidian 目录）`);
	process.exit(1);
}

const target = path.join(vault, '.obsidian', 'plugins', PLUGIN_ID);
fs.mkdirSync(path.dirname(target), { recursive: true });

if (fs.existsSync(target) || fs.lstatSync(path.dirname(target)).isDirectory()) {
	const stat = fs.existsSync(target) ? fs.lstatSync(target) : null;
	if (stat?.isSymbolicLink()) fs.unlinkSync(target);
	else if (stat?.isDirectory()) fs.rmSync(target, { recursive: true, force: true });
}

if (copyMode) {
	fs.mkdirSync(target, { recursive: true });
	const files = ['main.js', 'manifest.json', 'styles.css', 'versions.json'];
	for (const file of files) {
		const from = path.join(root, file);
		if (!fs.existsSync(from)) {
			console.error(`缺少 ${file}，请先运行 npm run build`);
			process.exit(1);
		}
		fs.copyFileSync(from, path.join(target, file));
	}
	// pdf.js 的 CMap 与标准字体已内联进 main.js（见 scripts/inline-pdf-assets.mjs），
	// 不需要再单独拷贝 assets 目录
	console.log(`已复制插件产物到 ${target}`);
} else {
	fs.symlinkSync(root, target, 'dir');
	console.log(`已软链 ${root} -> ${target}`);
}

console.log('\n在 Obsidian 里：设置 -> 第三方插件 -> 关闭安全模式 -> 启用 Pick Me。');
