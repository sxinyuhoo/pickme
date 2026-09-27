import esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const prod = process.argv[2] === 'production';

/** 把 pdf.js 的 worker 源码作为字符串内联进产物，运行时用 Blob URL 起 worker */
const inlinePdfWorker = {
	name: 'inline-pdf-worker',
	setup(build) {
		build.onResolve({ filter: /^pickme:pdf-worker$/ }, () => ({
			path: 'pickme:pdf-worker',
			namespace: 'pdf-worker',
		}));
		build.onLoad({ filter: /.*/, namespace: 'pdf-worker' }, () => {
			const workerPath = path.resolve('node_modules/pdfjs-dist/build/pdf.worker.min.mjs');
			if (!fs.existsSync(workerPath)) {
				throw new Error('找不到 pdf.worker.min.mjs，请先 npm install pdfjs-dist');
			}
			return { contents: fs.readFileSync(workerPath, 'utf8'), loader: 'text' };
		});
	},
};

const context = await esbuild.context({
	entryPoints: ['src/main.ts'],
	bundle: true,
	external: [
		'obsidian',
		'electron',
		'@codemirror/autocomplete',
		'@codemirror/collab',
		'@codemirror/commands',
		'@codemirror/language',
		'@codemirror/lint',
		'@codemirror/search',
		'@codemirror/state',
		'@codemirror/view',
		'@lezer/common',
		'@lezer/highlight',
		'@lezer/lr',
	],
	plugins: [inlinePdfWorker],
	format: 'cjs',
	target: 'chrome120',
	logLevel: 'info',
	sourcemap: prod ? false : 'inline',
	treeShaking: true,
	minify: prod,
	legalComments: 'none',
	define: {
		'import.meta.url': 'undefined',
	},
	outfile: 'main.js',
});

if (prod) {
	await context.rebuild();
	process.exit(0);
} else {
	await context.watch();
}
