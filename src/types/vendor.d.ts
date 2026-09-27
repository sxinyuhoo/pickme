/** pdf.js 的产物路径没有随包提供类型映射，这里手工补上 */
declare module 'pdfjs-dist/build/pdf.min.mjs' {
	export * from 'pdfjs-dist';
}

/** Node 侧集成测试用的 legacy 构建 */
declare module 'pdfjs-dist/legacy/build/pdf.mjs' {
	export * from 'pdfjs-dist';
}

/** 构建时由 esbuild 插件内联进来的 pdf.js worker 源码 */
declare module 'pickme:pdf-worker' {
	const source: string;
	export default source;
}
