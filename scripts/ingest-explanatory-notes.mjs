/**
 * Bulk ingest Explanatory Notes PDFs into D1 via wrangler.
 *
 * Usage:
 *   npm run ingest:notes
 *   npm run ingest:notes -- --remote
 *   EXPLANATORY_DIR=D:\Explanatory npm run ingest:notes -- --remote
 *   INGEST_API_URL=https://your-worker.example.com INGEST_SESSION=... npm run ingest:notes
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DEFAULT_DIR = path.join(ROOT, "knowledge", "explanatory-notes");
const SOURCE_DIR = process.env.EXPLANATORY_DIR || DEFAULT_DIR;
const VERSION = process.env.EXPLANATORY_VERSION || "TT HS Notes";
const remote = process.argv.includes("--remote");
const apiUrl = process.env.INGEST_API_URL?.replace(/\/$/, "");
const sessionCookie = process.env.INGEST_SESSION;

function sqlEscape(s) {
  return String(s).replace(/'/g, "''");
}

function parseFilename(filename) {
  const base = filename.replace(/\.pdf$/i, "").trim();
  const chMatch = base.match(/CH(\d{1,2})$/i);
  const chapter = chMatch ? String(parseInt(chMatch[1], 10)).padStart(2, "0") : null;
  const title = chapter ? `Chapter ${chapter} Explanatory Notes` : base;
  const section = /^intro/i.test(base) ? "introduction" : chapter ? "chapter" : "general";
  return { filename, title, chapter, section, version: VERSION };
}

function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && w.length < 32);
}

function extractKeywords(text, limit = 24) {
  const freq = new Map();
  for (const w of tokenize(text)) freq.set(w, (freq.get(w) || 0) + 1);
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([w]) => w)
    .join(" ");
}

function computeEmbedding(text) {
  const DIM = 128;
  const vec = new Array(DIM).fill(0);
  for (const token of tokenize(text)) {
    let h = 2166136261;
    for (let i = 0; i < token.length; i++) {
      h ^= token.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    vec[Math.abs(h) % DIM] += 1;
  }
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
  return JSON.stringify(vec.map((v) => v / norm));
}

function chunkPages(pages, meta) {
  const chunks = [];
  let chunkIndex = 0;
  let currentHeading = null;
  let currentSubheading = null;
  const maxChars = 900;

  for (const page of pages) {
    const paragraphs = page.text
      .split(/\n{2,}/)
      .map((p) => p.replace(/\s+/g, " ").trim())
      .filter(Boolean);
    let buffer = "";
    for (const para of paragraphs) {
      const head = para.match(/^([\d]{2}\.[\d]{2})\s+/);
      const sub = para.match(/^([\d]{2}\.[\d]{2}\.[\d]{2})\s+/);
      if (head) currentHeading = head[1];
      if (sub) {
        currentSubheading = sub[1];
        currentHeading = sub[1].slice(0, 5);
      }
      const next = buffer ? `${buffer}\n\n${para}` : para;
      if (next.length > maxChars && buffer) {
        chunks.push({
          section: meta.section,
          chapter: meta.chapter,
          heading: currentHeading,
          subheading: currentSubheading,
          page_number: page.pageNumber,
          chunk_index: chunkIndex++,
          chunk_text: buffer.slice(0, maxChars),
          keywords: extractKeywords(buffer),
        });
        buffer = para;
      } else {
        buffer = next;
      }
    }
    if (buffer.trim()) {
      chunks.push({
        section: meta.section,
        chapter: meta.chapter,
        heading: currentHeading,
        subheading: currentSubheading,
        page_number: page.pageNumber,
        chunk_index: chunkIndex++,
        chunk_text: buffer.trim().slice(0, maxChars),
        keywords: extractKeywords(buffer),
      });
    }
  }
  return chunks.filter((c) => c.chunk_text.length >= 40);
}

async function extractPdfPages(filePath) {
  const buffer = fs.readFileSync(filePath);
  const pages = [];
  await pdfParse(buffer, {
    pagerender: (pageData) =>
      pageData.getTextContent().then((tc) => {
        const text = tc.items.map((it) => it.str).join(" ");
        pages.push({ pageNumber: pageData.pageNumber, text });
        return text;
      }),
  });
  if (!pages.length) {
    const data = await pdfParse(buffer);
    const split = data.text.split("\f");
    split.forEach((text, i) => pages.push({ pageNumber: i + 1, text }));
  }
  const textLen = pages.reduce((n, p) => n + p.text.replace(/\s/g, "").length, 0);
  if (textLen < 80) {
    return extractPdfPagesViaAnthropic(filePath, buffer);
  }
  return pages;
}

async function extractPdfPagesViaAnthropic(filePath, buffer = fs.readFileSync(filePath)) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      `${path.basename(filePath)} appears to be scanned (no text layer). Set ANTHROPIC_API_KEY for OCR ingest.`,
    );
  }
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
      max_tokens: 8000,
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
              text: `Extract all readable text from this Trinidad & Tobago HS explanatory notes PDF.
Return plain text only. Prefix each page with a marker: --- PAGE N ---`,
            },
          ],
        },
      ],
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error?.message || `Anthropic OCR failed (${res.status})`);
  }
  const text = (data.content || []).map((b) => b.text || "").join("");
  const pages = [];
  const parts = text.split(/---\s*PAGE\s*(\d+)\s*---/i);
  if (parts.length > 1) {
    for (let i = 1; i < parts.length; i += 2) {
      pages.push({ pageNumber: Number(parts[i]), text: parts[i + 1]?.trim() || "" });
    }
  } else if (text.trim()) {
    pages.push({ pageNumber: 1, text: text.trim() });
  }
  return pages;
}

async function ingestViaApi(filename, pages) {
  const res = await fetch(`${apiUrl}/api/explanatory-notes/upload`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `pas_session=${sessionCookie}`,
    },
    body: JSON.stringify({
      filename,
      version: VERSION,
      pages: pages.map((p) => ({ page_number: p.pageNumber, text: p.text })),
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`${filename}: ${res.status} ${err}`);
  }
  return res.json();
}

function ingestViaWrangler(filename, meta, chunks) {
  const tmp = path.join(ROOT, ".tmp-ingest.sql");
  const lines = [];
  lines.push(`DELETE FROM explanatory_note_chunks WHERE document_id IN (SELECT id FROM explanatory_note_documents WHERE filename='${sqlEscape(filename)}');`);
  lines.push(`INSERT INTO explanatory_note_documents (filename, title, version, chapter, section, status, processed_at, chunk_count)
VALUES ('${sqlEscape(filename)}', '${sqlEscape(meta.title)}', '${sqlEscape(meta.version)}', ${meta.chapter ? `'${meta.chapter}'` : "NULL"}, '${sqlEscape(meta.section)}', 'ready', datetime('now'), ${chunks.length})
ON CONFLICT(filename) DO UPDATE SET title=excluded.title, version=excluded.version, chapter=excluded.chapter, section=excluded.section, status='ready', processed_at=datetime('now'), chunk_count=excluded.chunk_count;`);

  for (const c of chunks) {
    const emb = computeEmbedding(c.chunk_text);
    lines.push(`INSERT INTO explanatory_note_chunks (document_id, section, chapter, heading, subheading, page_number, chunk_index, chunk_text, keywords, embedding)
SELECT id, ${c.section ? `'${sqlEscape(c.section)}'` : "NULL"}, ${c.chapter ? `'${c.chapter}'` : "NULL"}, ${c.heading ? `'${sqlEscape(c.heading)}'` : "NULL"}, ${c.subheading ? `'${sqlEscape(c.subheading)}'` : "NULL"}, ${c.page_number ?? "NULL"}, ${c.chunk_index}, '${sqlEscape(c.chunk_text)}', '${sqlEscape(c.keywords)}', '${sqlEscape(emb)}'
FROM explanatory_note_documents WHERE filename='${sqlEscape(filename)}';`);
  }

  fs.writeFileSync(tmp, lines.join("\n"), "utf8");
  const flag = remote ? "--remote" : "--local";
  execSync(`npx wrangler d1 execute pas-trinidad ${flag} --file="${tmp}"`, {
    cwd: ROOT,
    stdio: "inherit",
  });
  fs.unlinkSync(tmp);
}

async function main() {
  if (!fs.existsSync(SOURCE_DIR)) {
    console.error(`Source directory not found: ${SOURCE_DIR}`);
    process.exit(1);
  }

  const files = fs
    .readdirSync(SOURCE_DIR)
    .filter((f) => f.toLowerCase().endsWith(".pdf"))
    .sort();

  if (!files.length) {
    console.error(`No PDFs in ${SOURCE_DIR}`);
    process.exit(1);
  }

  console.log(`Ingesting ${files.length} PDFs from ${SOURCE_DIR} (${remote || apiUrl ? "remote" : "local"} D1)`);

  for (const file of files) {
    const filePath = path.join(SOURCE_DIR, file);
    const meta = parseFilename(file);
    process.stdout.write(`→ ${file} … `);
    try {
      const pages = await extractPdfPages(filePath);
      const chunks = chunkPages(pages, meta);
      if (!chunks.length) {
        console.log("skipped (no chunks)");
        continue;
      }
      if (apiUrl && sessionCookie) {
        const res = await ingestViaApi(file, pages);
        console.log(`${res.chunk_count ?? chunks.length} chunks (API)`);
      } else {
        ingestViaWrangler(file, meta, chunks);
        console.log(`${chunks.length} chunks`);
      }
    } catch (e) {
      console.log(`FAILED: ${e instanceof Error ? e.message : e}`);
    }
  }

  console.log("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
