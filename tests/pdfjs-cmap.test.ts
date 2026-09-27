import test from 'node:test';
import assert from 'node:assert/strict';
import { CMAP_BASE64, CMAP_COUNT, STANDARD_FONT_BASE64, STANDARD_FONT_COUNT } from '../src/generated/pdfAssets.ts';

/**
 * 与 src/pdf/pdfjs.ts 里的 VaultCMapReaderFactory 同形，把「按需解码一份 base64」这一步换成
 * 直接读构建时内联进来的资源——CMap 早已编进 main.js，运行时不再依赖任何外部目录。
 */
class InlineCMapReaderFactory {
	baseUrl: string;
	isCompressed: boolean;

	constructor(options: { baseUrl?: string | null; isCompressed?: boolean }) {
		this.baseUrl = options.baseUrl ?? '';
		this.isCompressed = options.isCompressed ?? true;
	}

	async fetch({ name }: { name: string }): Promise<{ cMapData: Uint8Array; isCompressed: boolean }> {
		const data = CMAP_BASE64[name];
		if (!data) throw new Error(`缺少内联的 CMap：${name}`);
		return { cMapData: new Uint8Array(Buffer.from(data, 'base64')), isCompressed: true };
	}
}

/** 一份用预定义 CMap（GBK-EUC-H）、字体未嵌入的中文 PDF，内容是「你好」 */
function buildCjkPdf(): Uint8Array {
	const stream = 'BT /F1 20 Tf 40 200 Td <C4E3BAC3> Tj ET';
	const bodies = [
		'<< /Type /Catalog /Pages 2 0 R >>',
		'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
		'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 300] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
		`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
		'<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /GBK-EUC-H /DescendantFonts [6 0 R] >>',
		'<< /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 4 >> /FontDescriptor 7 0 R /DW 1000 >>',
		'<< /Type /FontDescriptor /FontName /STSong-Light /Flags 4 /FontBBox [0 -120 1000 880] /ItalicAngle 0 /Ascent 880 /Descent -120 /CapHeight 880 /StemV 80 >>',
	];

	let pdf = '%PDF-1.4\n';
	const offsets: number[] = [];
	bodies.forEach((body, index) => {
		offsets.push(pdf.length);
		pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
	});
	const xrefStart = pdf.length;
	pdf += `xref\n0 ${bodies.length + 1}\n0000000000 65535 f \n`;
	for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
	pdf += `trailer\n<< /Size ${bodies.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
	return new TextEncoder().encode(pdf);
}

test('CMap 与标准字体已经内联进源码（构建产物不再依赖外部目录）', () => {
	assert.ok(CMAP_COUNT >= 160, `内联的 CMap 偏少：${CMAP_COUNT}（先跑 npm run assets）`);
	assert.ok('GBK-EUC-H' in CMAP_BASE64, '缺少中文用的 GBK-EUC-H');
	assert.equal(
		Object.keys(STANDARD_FONT_BASE64).length,
		STANDARD_FONT_COUNT,
		'标准字体数量与声明的对不上（先跑 npm run assets）',
	);
	assert.ok(STANDARD_FONT_COUNT >= 10, `内联的标准字体偏少：${STANDARD_FONT_COUNT}`);
});

test('走自定义工厂能读到未嵌入字体的中文 PDF 文字', async () => {
	const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
	const doc = await pdfjs.getDocument({
		data: buildCjkPdf(),
		useSystemFonts: false,
		isEvalSupported: false,
		disableFontFace: true,
		cMapUrl: '',
		cMapPacked: true,
		CMapReaderFactory: InlineCMapReaderFactory,
	}).promise;

	const page = await doc.getPage(1);
	const content = await page.getTextContent();
	const text = content.items
		.filter((item) => 'str' in item)
		.map((item) => (item as { str: string }).str)
		.join('');
	assert.equal(text, '你好', `应当通过 CMap 还原出「你好」，实际「${text}」`);
	await doc.destroy();
});

test('不给 CMap 资源时同一份 PDF 取不到文字（说明上一条测的是真链路）', async () => {
	const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
	let text = '';
	try {
		const doc = await pdfjs.getDocument({
			data: buildCjkPdf(),
			useSystemFonts: false,
			isEvalSupported: false,
			disableFontFace: true,
		}).promise;
		const page = await doc.getPage(1);
		const content = await page.getTextContent();
		text = content.items
			.filter((item) => 'str' in item)
			.map((item) => (item as { str: string }).str)
			.join('');
		await doc.destroy();
	} catch {
		text = '';
	}
	assert.notEqual(text, '你好', '没有 CMap 时不应该能正确还原中文');
});
