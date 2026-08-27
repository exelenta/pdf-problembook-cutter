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
    showProblemNumbers: true,
  });
  const output = await PDFDocument.load(outputBytes);
  assert.equal(output.getPageCount(), 1);
  assert.equal(output.getTitle(), 'Test problembook');
});

test('제목 이미지와 문제 번호 표시 옵션을 적용해 PDF를 만든다', async () => {
  const source = await PDFDocument.create();
  const page = source.addPage([600, 800]);
  page.drawLine({ start: { x: 20, y: 700 }, end: { x: 280, y: 700 } });
  const sourceBytes = await source.save();
  const titleImage = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'));

  const outputBytes = await generateProblembook({
    source: sourceBytes,
    problems: [{ id: 1, fragments: [{ page: 1, column: 'left', yStart: 0.1, yEnd: 0.25 }] }],
    cropForPage: () => DEFAULT_CROP,
    answerSpaceMm: 0,
    ruled: false,
    title: 'Title option',
    titleImage,
    showProblemNumbers: false,
  });

  const output = await PDFDocument.load(outputBytes);
  assert.equal(output.getPageCount(), 1);
  assert.equal(output.getTitle(), 'Title option');
});
