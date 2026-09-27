import test from 'node:test';
import assert from 'node:assert/strict';
import { pdfToScreenRect, screenToPdfRect, toNormalized } from '../src/core/pdfgeom.ts';
import { itemBox, textInRect } from '../src/core/pdftext.ts';
import type { RawTextItem } from '../src/core/pdftext.ts';

/** 手工拼一份合法的最小 PDF：两行文字，页面 400x300 */
function buildPdf(): Uint8Array {
	const stream = [
		'BT /F1 18 Tf 40 200 Td (Pick Me PDF Test) Tj ET',
		'BT /F1 12 Tf 40 160 Td (Maximum grade 3 percent) Tj ET',
	].join('\n');
	const bodies = [
		'<< /Type /Catalog /Pages 2 0 R >>',
		'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
		'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 300] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
		`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
		'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
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

async function loadTestPage() {
	const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
	const task = pdfjs.getDocument({
		data: buildPdf(),
		useSystemFonts: false,
		isEvalSupported: false,
		disableFontFace: true,
	});
	const doc = await task.promise;
	const page = await doc.getPage(1);
	return { doc, page };
}

test('手写的测试 PDF 能被 pdf.js 解析，页面尺寸与 MediaBox 一致', async () => {
	const { doc, page } = await loadTestPage();
	assert.equal(doc.numPages, 1);
	const viewport = page.getViewport({ scale: 1 });
	assert.equal(Math.round(viewport.width), 400);
	assert.equal(Math.round(viewport.height), 300);
	await doc.destroy();
});

test('框选矩形能取到对应的文字，其他文字不混入', async () => {
	const { doc, page } = await loadTestPage();
	const content = await page.getTextContent();
	const raw: RawTextItem[] = [];
	for (const item of content.items) {
		if ('str' in item) {
			raw.push({
				str: item.str,
				transform: item.transform,
				width: item.width,
				height: item.height,
			});
		}
	}
	assert.ok(raw.length >= 2, `应当取到两行文字，实际 ${raw.length}`);

	// 第一行文字在 PDF 坐标里大约位于 y=200，第二行在 y=160
	const first = textInRect(raw, [30, 190, 300, 225]);
	assert.equal(first, 'Pick Me PDF Test');
	const second = textInRect(raw, [30, 150, 300, 180]);
	assert.equal(second, 'Maximum grade 3 percent');
	assert.equal(textInRect(raw, [30, 240, 300, 290]), '');
	await doc.destroy();
});

test('我算的 PDF 坐标与 pdf.js 自己的坐标变换一致', async () => {
	const { doc, page } = await loadTestPage();
	const viewport = page.getViewport({ scale: 2 });
	const pageSize: [number, number] = [400, 300];
	const viewportSize: [number, number] = [viewport.width, viewport.height];

	// 取一个屏幕点，分别用 pdf.js 的方法和我自己的公式换算
	const screenPoint: [number, number] = [120, 80];
	const expected = viewport.convertToPdfPoint(screenPoint[0], screenPoint[1]);
	const mine = screenToPdfRect(
		[screenPoint[0], screenPoint[1], screenPoint[0], screenPoint[1]],
		viewportSize,
		pageSize,
	);
	assert.ok(
		Math.abs(mine[0] - expected[0]) < 0.001 && Math.abs(mine[3] - expected[1]) < 0.001,
		`我的换算 ${mine[0]},${mine[3]} 与 pdf.js 的 ${expected[0]},${expected[1]} 不一致`,
	);
	await doc.destroy();
});

test('屏幕矩形与 PDF 矩形可以来回换算', async () => {
	const pageSize: [number, number] = [400, 300];
	const viewportSize: [number, number] = [800, 600];
	const screenRect: [number, number, number, number] = [80, 60, 420, 120];
	const pdfRect = screenToPdfRect(screenRect, viewportSize, pageSize);
	assert.deepEqual(pdfRect.map((n) => Math.round(n)), [40, 240, 210, 270]);
	assert.deepEqual(
		pdfToScreenRect(pdfRect, viewportSize, pageSize).map((n) => Math.round(n)),
		screenRect,
	);
	assert.deepEqual(
		toNormalized(pdfRect, pageSize).map((n) => Number(n.toFixed(3))),
		[0.1, 0.8, 0.525, 0.9],
	);
});

test('取出的文字项方框与 pdf.js 给的坐标一致', async () => {
	const { doc, page } = await loadTestPage();
	const content = await page.getTextContent();
	const first = content.items.find((item) => 'str' in item && item.str.includes('Pick Me'));
	assert.ok(first && 'transform' in first);
	const box = itemBox({
		str: first.str,
		transform: first.transform,
		width: first.width,
		height: first.height,
	});
	assert.equal(box.x, 40);
	assert.ok(Math.abs(box.y - 200) < 0.001, `基线 y 应为 200，实际 ${box.y}`);
	assert.ok(box.width > 50);
	await doc.destroy();
});
