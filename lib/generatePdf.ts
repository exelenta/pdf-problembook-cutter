import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { cropXRange, type CropPreset, type Problem } from './problembook.ts';

const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;
const MM = 72 / 25.4;

interface GenerateOptions {
  source: Uint8Array;
  problems: Problem[];
  cropForPage: (page: number) => CropPreset;
  answerSpaceMm: number;
  ruled: boolean;
  appendixStart?: number;
  appendixEnd?: number;
  title: string;
}

export async function generateProblembook(options: GenerateOptions) {
  const sourcePdf = await PDFDocument.load(options.source, { ignoreEncryption: false });
  const output = await PDFDocument.create();
  const font = await output.embedFont(StandardFonts.Helvetica);
  const margin = 12 * MM;
  const gap = 7 * MM;
  const columnWidth = (A4_WIDTH - margin * 2 - gap) / 2;
  const columnHeight = A4_HEIGHT - margin * 2;
  const answerSpace = options.answerSpaceMm * MM;
  let outPage = output.addPage([A4_WIDTH, A4_HEIGHT]);
  let outColumn = 0;
  let cursorTop = margin;

  const advance = () => {
    if (outColumn === 0) outColumn = 1;
    else {
      outPage = output.addPage([A4_WIDTH, A4_HEIGHT]);
      outColumn = 0;
    }
    cursorTop = margin;
  };

  for (const problem of options.problems) {
    const measurements = problem.fragments.map((fragment) => {
      const page = sourcePdf.getPage(fragment.page - 1);
      const { width, height } = page.getSize();
      const crop = options.cropForPage(fragment.page);
      const x = cropXRange(fragment.column, crop);
      return {
        fragment,
        page,
        left: width * x.start,
        right: width * x.end,
        bottom: height * (1 - fragment.yEnd),
        top: height * (1 - fragment.yStart),
        width: width * (x.end - x.start),
        height: height * (fragment.yEnd - fragment.yStart),
      };
    });
    const baseScale = Math.min(1, ...measurements.map((item) => columnWidth / item.width));
    const contentHeight = measurements.reduce((sum, item) => sum + item.height, 0);
    const scale = Math.min(baseScale, (columnHeight - answerSpace - 18) / contentHeight);
    const blockHeight = contentHeight * scale + answerSpace + 14;
    if (cursorTop + blockHeight > A4_HEIGHT - margin && cursorTop > margin) advance();

    const x = margin + outColumn * (columnWidth + gap);
    let yTop = cursorTop;
    outPage.drawText(String(problem.id).padStart(2, '0'), {
      x,
      y: A4_HEIGHT - yTop - 8,
      size: 7,
      font,
      color: rgb(0.12, 0.42, 0.31),
    });
    yTop += 12;

    for (const item of measurements) {
      const embedded = await output.embedPage(item.page, {
        left: item.left,
        right: item.right,
        bottom: item.bottom,
        top: item.top,
      });
      const drawnHeight = item.height * scale;
      outPage.drawPage(embedded, {
        x,
        y: A4_HEIGHT - yTop - drawnHeight,
        width: item.width * scale,
        height: drawnHeight,
      });
      yTop += drawnHeight;
    }

    if (options.ruled && answerSpace > 12) {
      for (let lineY = yTop + 15; lineY < yTop + answerSpace; lineY += 18) {
        outPage.drawLine({
          start: { x, y: A4_HEIGHT - lineY },
          end: { x: x + columnWidth, y: A4_HEIGHT - lineY },
          thickness: 0.35,
          color: rgb(0.84, 0.87, 0.84),
        });
      }
    }
    cursorTop = yTop + answerSpace + 2;
  }

  if (!options.problems.length) output.removePage(0);
  if (options.appendixStart && options.appendixEnd) {
    const start = Math.max(1, options.appendixStart);
    const end = Math.min(sourcePdf.getPageCount(), options.appendixEnd);
    if (start <= end) {
      const copies = await output.copyPages(sourcePdf, Array.from({ length: end - start + 1 }, (_, i) => start - 1 + i));
      copies.forEach((page) => output.addPage(page));
    }
  }
  output.setTitle(options.title);
  output.setCreator('PDF Problembook Cutter');
  output.setProducer('pdf-lib');
  return output.save();
}
