#!/usr/bin/env node
/**
 * Duty Desk Knowledge Engine — pilot ingest (Chapters 01–05).
 *
 * Usage:
 *   npm run knowledge:ingest-pilot
 *   EXPLANATORY_DIR=D:\Explanatory npm run knowledge:ingest-pilot
 *   npm run knowledge:ingest-pilot -- --chapters 01,02,03
 *   npm run knowledge:ingest-pilot -- --ocr anthropic|tesseract|auto
 */
import fs from "node:fs";
import path from "node:path";
import { DIRS, ROOT, chapterDir, ensureDirs, loadEnvFile } from "./lib/paths.mjs";
import { ocrPdf, saveRawPages } from "./lib/ocr.mjs";
import { parseChapterFromPages } from "./lib/parse-notes.mjs";
import { writeChapterOutput } from "./lib/write-chapter.mjs";

loadEnvFile();

const DEFAULT_SOURCE = process.env.EXPLANATORY_DIR || "D:\\Explanatory";
const PILOT_CHAPTERS = ["01", "02", "03", "04", "05"];

function parseArgs() {
  const chaptersArg = process.argv.find((a) => a.startsWith("--chapters="));
  const chapters = chaptersArg
    ? chaptersArg
        .split("=")[1]
        .split(",")
        .map((c) => c.trim().padStart(2, "0"))
    : PILOT_CHAPTERS;

  const ocrArg = process.argv.find((a) => a.startsWith("--ocr="));
  const ocr = ocrArg ? ocrArg.split("=")[1] : "auto";

  return { chapters, ocr };
}

function pdfName(chapter) {
  return `Explanatory Notes CH${chapter}.pdf`;
}

function copyRawPdf(sourcePath, chapter) {
  const destDir = chapterDir(chapter, "raw");
  fs.mkdirSync(destDir, { recursive: true });
  const dest = path.join(destDir, path.basename(sourcePath));
  if (!fs.existsSync(dest) || fs.statSync(dest).mtimeMs < fs.statSync(sourcePath).mtimeMs) {
    fs.copyFileSync(sourcePath, dest);
  }
  return dest;
}

async function processChapter(chapter, sourceDir, ocrMode) {
  const filename = pdfName(chapter);
  const sourcePath = path.join(sourceDir, filename);
  const result = {
    chapter,
    filename,
    pagesOcred: 0,
    headingsExtracted: 0,
    failedPages: [],
    outputPaths: [],
    ocrMethod: null,
    error: null,
  };

  if (!fs.existsSync(sourcePath)) {
    result.error = `PDF not found: ${sourcePath}`;
    return result;
  }

  try {
    const rawPdfPath = copyRawPdf(sourcePath, chapter);
    const buffer = fs.readFileSync(sourcePath);
    const rawChapterDir = chapterDir(chapter, "raw");

    console.log(`  OCR ${filename}…`);
    const { pages, method } = await ocrPdf(buffer, filename, { prefer: ocrMode });
    result.ocrMethod = method;

    for (const p of pages) {
      if (!p.text || p.text.replace(/\s/g, "").length < 20) {
        result.failedPages.push(p.pageNumber);
      }
    }

    saveRawPages(chapter, pages, rawChapterDir);
    result.pagesOcred = pages.length;

    const parsed = parseChapterFromPages(chapter, pages, path.basename(rawPdfPath));
    const written = writeChapterOutput(parsed, path.basename(rawPdfPath));
    result.headingsExtracted = written.headingCount;
    result.outputPaths = written.files;
    result.outputPaths.push(rawPdfPath);
    result.indexPath = written.indexPath;
    result.processedDir = written.outDir;
  } catch (e) {
    result.error = e instanceof Error ? e.message : String(e);
  }

  return result;
}

async function main() {
  const { chapters, ocr } = parseArgs();
  const sourceDir = DEFAULT_SOURCE;

  console.log("Duty Desk Knowledge Engine — pilot ingest");
  console.log(`Source: ${sourceDir}`);
  console.log(`Chapters: ${chapters.join(", ")}`);
  console.log(`OCR mode: ${ocr}`);
  console.log(`Output root: ${path.join(ROOT, "knowledge")}\n`);

  ensureDirs();

  const summary = {
    chapters_processed: 0,
    total_pages_ocred: 0,
    total_headings: 0,
    failed_pages: [],
    chapter_results: [],
    errors: [],
  };

  for (const ch of chapters) {
    console.log(`Chapter ${ch}`);
    const r = await processChapter(ch, sourceDir, ocr);
    summary.chapter_results.push(r);

    if (r.error) {
      console.log(`  ERROR: ${r.error}\n`);
      summary.errors.push({ chapter: ch, error: r.error });
      continue;
    }

    summary.chapters_processed++;
    summary.total_pages_ocred += r.pagesOcred;
    summary.total_headings += r.headingsExtracted;
    for (const fp of r.failedPages) {
      summary.failed_pages.push({ chapter: ch, page: fp });
    }

    console.log(`  OCR: ${r.ocrMethod}, ${r.pagesOcred} pages, ${r.headingsExtracted} headings`);
    if (r.failedPages.length) console.log(`  Low-quality pages: ${r.failedPages.join(", ")}`);
    console.log(`  → ${r.processedDir}\n`);
  }

  const reportPath = path.join(DIRS.indexes, "pilot-ingest-report.json");
  fs.writeFileSync(reportPath, JSON.stringify({ ...summary, generated_at: new Date().toISOString() }, null, 2));

  console.log("═".repeat(60));
  console.log("PILOT INGEST SUMMARY");
  console.log("═".repeat(60));
  console.log(`Chapters processed:  ${summary.chapters_processed}/${chapters.length}`);
  console.log(`Pages OCRed:         ${summary.total_pages_ocred}`);
  console.log(`Headings extracted:  ${summary.total_headings}`);
  console.log(`Failed/low pages:    ${summary.failed_pages.length}`);
  if (summary.failed_pages.length) {
    for (const f of summary.failed_pages) {
      console.log(`  - Chapter ${f.chapter} page ${f.page}`);
    }
  }
  if (summary.errors.length) {
    console.log("Errors:");
    for (const e of summary.errors) console.log(`  - Ch.${e.chapter}: ${e.error}`);
  }
  console.log("\nOutput paths:");
  for (const r of summary.chapter_results) {
    if (r.processedDir) {
      console.log(`  ${r.processedDir}`);
      console.log(`  ${r.indexPath}`);
    }
  }
  console.log(`\nReport: ${reportPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
