import fs from "node:fs";
import path from "node:path";
import { chapterDir } from "./paths.mjs";
import { headingFileSlug } from "./parse-notes.mjs";

function mdSection(title, body) {
  if (!body || (Array.isArray(body) && !body.length)) return "";
  if (Array.isArray(body)) {
    return `## ${title}\n\n${body.map((x) => `- ${x}`).join("\n")}\n\n`;
  }
  return `## ${title}\n\n${body}\n\n`;
}

function writeHeadingFile(outDir, h, chapter, sourcePdf) {
  const slug = headingFileSlug(h.code);
  const filePath = path.join(outDir, `${slug}.md`);
  const subMd =
    h.subheadings?.length > 0
      ? `## Subheading notes\n\n${h.subheadings
          .map((s) => `### ${s.code} — ${s.title}\n`)
          .join("\n")}`
      : "";

  const content = `# Heading ${h.code} — ${h.title}

## Heading code
${h.code}

## Title
${h.title}

## Explanatory note
${h.explanatory_note || "_No explanatory note text extracted._"}

${mdSection("Includes", h.includes)}
${mdSection("Excludes", h.excludes)}
${subMd}
${mdSection("Related headings", h.related_headings)}

## Keywords
${(h.keywords || []).join(", ")}

## Source
- PDF: ${sourcePdf}
- Page(s): ${(h.source_pages || []).join(", ")}
- Chapter: ${chapter}
`;

  fs.writeFileSync(filePath, content, "utf8");
  return { slug, filePath: path.relative(path.join(outDir, "..", ".."), filePath).replace(/\\/g, "/") };
}

export function writeChapterOutput(parsed, sourcePdf) {
  const chapter = parsed.chapter;
  const outDir = chapterDir(chapter, "processed");
  const indexDir = chapterDir(chapter, "indexes");
  fs.mkdirSync(outDir, { recursive: true });
  fs.mkdirSync(indexDir, { recursive: true });

  const chapterNotesPath = path.join(outDir, "chapter-notes.md");
  const chapterNotesBody =
    parsed.chapter_notes?.length > 0
      ? parsed.chapter_notes.map((n) => `${n.number}. ${n.text}`).join("\n\n")
      : "_No numbered chapter notes detected._";

  fs.writeFileSync(
    chapterNotesPath,
    `# Chapter ${chapter} — Notes\n\n${chapterNotesBody}\n\n## Source\n- PDF: ${sourcePdf}\n`,
    "utf8",
  );

  if (parsed.section_notes?.length) {
    fs.writeFileSync(
      path.join(outDir, "section-notes.md"),
      `# Section notes\n\n${parsed.section_notes.map((s) => `## Section ${s.section}\n\n${s.text}`).join("\n\n")}\n`,
      "utf8",
    );
  }

  fs.writeFileSync(
    path.join(outDir, "general.md"),
    `# Chapter ${chapter} — General notes\n\n${parsed.general_notes || parsed.chapter_title || "_No general notes detected._"}\n\n## Source\n- PDF: ${sourcePdf}\n`,
    "utf8",
  );

  const indexEntries = [];
  const writtenFiles = [];

  for (const h of parsed.headings) {
    const { slug, filePath } = writeHeadingFile(outDir, h, chapter, sourcePdf);
    writtenFiles.push(path.join(outDir, `${slug}.md`));
    indexEntries.push({
      chapter,
      heading: h.code,
      title: h.title,
      keywords: h.keywords || [],
      includes: h.includes || [],
      excludes: h.excludes || [],
      related_headings: h.related_headings || [],
      source_pages: h.source_pages || [],
      file_path: `knowledge/processed/explanatory-notes/chapter-${chapter}/heading-${h.code.replace(".", "")}.md`,
    });
  }

  const index = {
    chapter,
    chapter_title: parsed.chapter_title,
    source_pdf: sourcePdf,
    heading_count: indexEntries.length,
    headings: indexEntries,
    files: {
      chapter_notes: `knowledge/processed/explanatory-notes/chapter-${chapter}/chapter-notes.md`,
      general: `knowledge/processed/explanatory-notes/chapter-${chapter}/general.md`,
      headings: indexEntries.map((e) => e.file_path),
    },
    generated_at: new Date().toISOString(),
  };

  const indexPath = path.join(outDir, "index.json");
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2), "utf8");
  fs.writeFileSync(path.join(indexDir, "index.json"), JSON.stringify(index, null, 2), "utf8");

  return {
    outDir,
    indexPath,
    indexDir: path.join(indexDir, "index.json"),
    headingCount: indexEntries.length,
    files: [chapterNotesPath, path.join(outDir, "general.md"), ...writtenFiles, indexPath],
  };
}
