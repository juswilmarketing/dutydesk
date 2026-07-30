import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse");

const DEFAULT_WORKER_URL = "https://pas-trinidad-api.mwilson-561.workers.dev";
const DEFAULT_SECRET = "dev-pilot-ingest-local-only";

/** Try embedded text layer first; returns null if scanned/empty. */
export async function extractTextLayer(buffer) {
  const data = await pdfParse(buffer);
  const pages = [];
  const split = data.text.split("\f");
  if (split.length > 1) {
    split.forEach((text, i) => pages.push({ pageNumber: i + 1, text: text.trim() }));
  } else if (data.numpages > 1) {
    for (let i = 1; i <= data.numpages; i++) pages.push({ pageNumber: i, text: "" });
    if (data.text.trim()) pages[0] = { pageNumber: 1, text: data.text.trim() };
  } else {
    pages.push({ pageNumber: 1, text: data.text.trim() });
  }
  const textLen = pages.reduce((n, p) => n + p.text.replace(/\s/g, "").length, 0);
  return textLen >= 80 ? pages : null;
}

async function ocrViaAnthropicDirect(buffer, filename) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");
  const base64 = buffer.toString("base64");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 16000,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "document",
              source: { type: "base64", media_type: "application/pdf", data: base64 },
            },
            {
              type: "text",
              text: `OCR this Trinidad & Tobago HS Explanatory Notes PDF (${filename}).
Return ONLY plain text. Before each page write exactly: --- PAGE N --- (N = page number).`,
            },
          ],
        },
      ],
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || `Anthropic OCR failed (${res.status})`);
  const text = (data.content || []).map((b) => b.text || "").join("");
  return splitPageMarkers(text);
}

async function ocrViaWorker(buffer, filename, attempt = 1) {
  const workerUrl = (process.env.KNOWLEDGE_WORKER_URL || DEFAULT_WORKER_URL).replace(/\/$/, "");
  const secret = process.env.KNOWLEDGE_INGEST_SECRET || DEFAULT_SECRET;
  const base64 = buffer.toString("base64");

  const res = await fetch(`${workerUrl}/api/knowledge/ocr-pages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Knowledge-Ingest-Secret": secret,
    },
    body: JSON.stringify({ filename, pdf_base64: base64 }),
    signal: AbortSignal.timeout(300_000),
  });

  const raw = await res.text();
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    if (attempt < 3 && (raw.includes("524") || raw.includes("timeout"))) {
      console.log(`    retry ${attempt + 1}/3 after timeout…`);
      await new Promise((r) => setTimeout(r, 5000 * attempt));
      return ocrViaWorker(buffer, filename, attempt + 1);
    }
    if (raw.includes("524") || raw.includes("timeout")) {
      return await ocrViaWorkerPerPage(buffer, filename);
    }
    throw new Error(raw.slice(0, 200) || `Worker OCR failed (${res.status})`);
  }

  if (!res.ok) {
    if (attempt < 3) {
      await new Promise((r) => setTimeout(r, 5000 * attempt));
      return ocrViaWorker(buffer, filename, attempt + 1);
    }
    throw new Error(data?.error || `Worker OCR failed (${res.status})`);
  }

  return {
    pages: (data.pages || []).map((p) => ({
      pageNumber: p.page_number,
      text: p.text || "",
    })),
    perPage: false,
  };
}

async function ocrViaWorkerPerPage(buffer, filename) {
  const { PDFDocument } = await import("pdf-lib");
  const src = await PDFDocument.load(buffer, { ignoreEncryption: true });
  const total = src.getPageCount();
  const pages = [];
  console.log(`    per-page OCR (${total} pages)…`);

  for (let i = 0; i < total; i++) {
    const single = await PDFDocument.create();
    const [copied] = await single.copyPages(src, [i]);
    single.addPage(copied);
    const bytes = await single.save();
    const pageBuf = Buffer.from(bytes);
    const workerUrl = (process.env.KNOWLEDGE_WORKER_URL || DEFAULT_WORKER_URL).replace(/\/$/, "");
    const secret = process.env.KNOWLEDGE_INGEST_SECRET || DEFAULT_SECRET;

    const res = await fetch(`${workerUrl}/api/knowledge/ocr-pages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Knowledge-Ingest-Secret": secret,
      },
      body: JSON.stringify({
        filename: `${filename} (page ${i + 1})`,
        pdf_base64: pageBuf.toString("base64"),
      }),
      signal: AbortSignal.timeout(120_000),
    });

    const raw = await res.text();
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      throw new Error(`Page ${i + 1} OCR failed: ${raw.slice(0, 120)}`);
    }
    if (!res.ok) throw new Error(data?.error || `Page ${i + 1} OCR failed`);

    const text = (data.pages || [])
      .map((p) => p.text)
      .join("\n")
      .trim();
    pages.push({ pageNumber: i + 1, text });
    process.stdout.write(`    page ${i + 1}/${total} `);
  }
  process.stdout.write("\n");
  return { pages, perPage: true };
}

function splitPageMarkers(text) {
  const pages = [];
  const parts = text.split(/---\s*PAGE\s*(\d+)\s*---/i);
  if (parts.length > 1) {
    for (let i = 1; i < parts.length; i += 2) {
      pages.push({ pageNumber: Number(parts[i]), text: (parts[i + 1] || "").trim() });
    }
  } else if (text.trim()) {
    pages.push({ pageNumber: 1, text: text.trim() });
  }
  return pages;
}

/**
 * OCR a PDF into per-page text.
 * Order: text layer → worker (Anthropic) → direct Anthropic.
 */
export async function ocrPdf(buffer, filename, { prefer = "auto" } = {}) {
  if (prefer !== "worker" && prefer !== "anthropic") {
    const layer = await extractTextLayer(buffer);
    if (layer) return { pages: layer, method: "text-layer" };
  }

  if (prefer === "anthropic" || process.env.ANTHROPIC_API_KEY) {
    try {
      const pages = await ocrViaAnthropicDirect(buffer, filename);
      if (pages.length) return { pages, method: "anthropic-direct" };
    } catch (e) {
      if (prefer === "anthropic") throw e;
    }
  }

  const workerResult = await ocrViaWorker(buffer, filename);
  return {
    pages: workerResult.pages,
    method: workerResult.perPage ? "worker-anthropic-per-page" : "worker-anthropic",
  };
}

export function saveRawPages(chapter, pages, rawChapterDir) {
  fs.mkdirSync(rawChapterDir, { recursive: true });
  const manifest = [];
  for (const p of pages) {
    const file = `page-${String(p.pageNumber).padStart(3, "0")}.txt`;
    const filePath = path.join(rawChapterDir, file);
    fs.writeFileSync(filePath, p.text, "utf8");
    manifest.push({ page: p.pageNumber, file, chars: p.text.length });
  }
  fs.writeFileSync(
    path.join(rawChapterDir, "ocr-manifest.json"),
    JSON.stringify({ pages: manifest }, null, 2),
    "utf8",
  );
  return manifest;
}
