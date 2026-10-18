// [MEAL-25] A recipe file's text, read on the admin's own device with free open-source libraries
// (WP-105, D-138 (6), Q21): a PDF's text with pdf.js, a photo's with Tesseract.js. Never a paid
// service, and the file never leaves the household's own storage to be read. The libraries are
// passed in, so the browser and the tests use the same code.

/** The few parts of pdf.js used here. */
export interface PdfJs {
  getDocument: (src: { data: Uint8Array; isEvalSupported?: boolean }) => {
    promise: Promise<{
      numPages: number;
      getPage: (n: number) => Promise<{
        getTextContent: () => Promise<{ items: unknown[] }>;
      }>;
    }>;
  };
}

/** A PDF's text, page by page, a line each where its lines break (at most 20 pages). */
export async function pdfText(pdfjs: PdfJs, data: Uint8Array): Promise<string> {
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false }).promise;
  const pages: string[] = [];
  for (let n = 1; n <= Math.min(doc.numPages, 20); n += 1) {
    const page = await doc.getPage(n);
    const { items } = await page.getTextContent();
    let line = '';
    const lines: string[] = [];
    for (const it of items as { str?: string; hasEOL?: boolean }[]) {
      line += it.str ?? '';
      if (it.hasEOL) {
        lines.push(line);
        line = '';
      }
    }
    if (line) lines.push(line);
    pages.push(lines.join('\n'));
  }
  return pages.join('\n');
}

/** The few parts of Tesseract.js used here. */
export interface Ocr {
  createWorker: (
    lang: string,
    oem?: number,
    options?: Record<string, unknown>,
  ) => Promise<{
    recognize: (image: unknown) => Promise<{ data: { text: string } }>;
    terminate: () => Promise<unknown>;
  }>;
}

/** A photo's text, read by Tesseract.js in English. `options` says where its files are. */
export async function photoText(
  ocr: Ocr,
  image: unknown,
  options: Record<string, unknown> = {},
): Promise<string> {
  const worker = await ocr.createWorker('eng', 1, options);
  try {
    const { data } = await worker.recognize(image);
    return data.text;
  } finally {
    await worker.terminate();
  }
}
