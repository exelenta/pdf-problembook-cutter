import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { generateProblembook } from '../lib/generatePdf.ts';
import { DEFAULT_CROP } from '../lib/problembook.ts';

test('선택한 조각과 풀이 공간으로 읽을 수 있는 PDF를 만든다', async () => {
  const source = await PDFDocument.create();
  const page = source.addPage([600, 800]);
  const font = await source.embedFont(StandardFonts.Helvetica);
  page.drawText('Sample problem', { x: 40, y: 680, size: 18, font });
  const sourceBytes = await source.save();

  const outputBytes = await generateProblembook({
    source: sourceBytes,
    problems: [{ id: 1, fragments: [{ page: 1, column: 'left', yStart: 0.1, yEnd: 0.35 }] }],
    cropForPage: () => DEFAULT_CROP,
    answerSpaceMm: 30,
    ruled: true,
    title: 'Test problembook',
  });
  const output = await PDFDocument.load(outputBytes);
  assert.equal(output.getPageCount(), 1);
  assert.equal(output.getTitle(), 'Test problembook');
});
