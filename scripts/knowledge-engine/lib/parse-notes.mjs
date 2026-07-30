/**
 * Parse OCR text from T&T HS Explanatory Notes into structured chapter/heading data.
 */

const HEADING_RE = /(?:^|\n)\s*(?:Heading\s+)?(\d{2})\.(\d{2})\s*[-–—]?\s*([^\n]+)/gi;
const SUBHEADING_RE = /(?:^|\n)\s*(?:Subheading\s+)?(\d{2})(\d{2})\.(\d{2})\s*[-–—]?\s*([^\n]+)/gi;
const CHAPTER_NOTE_RE = /(?:^|\n)\s*(\d+)\s*\.?\s*[-–—]\s+/g;

export function extractKeywords(text, limit = 20) {
  const freq = new Map();
  for (const w of text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((x) => x.length > 3 && x.length < 24)) {
    freq.set(w, (freq.get(w) || 0) + 1);
  }
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([w]) => w);
}

function normalizeHeadingCode(ch1, ch2) {
  return `${ch1}.${ch2}`;
}

function findSectionBounds(fullText) {
  const chapterMatch = fullText.match(
    /(?:^|\n)\s*(?:CHAPTER|Chapter)\s+(\d{1,2})\b[^\n]*\n?([^\n]+)?/i,
  );
  const chapterTitle = chapterMatch
    ? (chapterMatch[2] || "").trim() || `Chapter ${chapterMatch[1]}`
    : "";

  const generalStart = fullText.search(
    /(?:^|\n)\s*(?:General|GENERAL)\s*(?:notes?|Notes?)?\s*(?:\.|:)?\s*\n/i,
  );
  const firstHeading = fullText.search(/(?:^|\n)\s*(?:Heading\s+)?\d{2}\.\d{2}\b/i);

  return { chapterTitle, generalStart, firstHeading };
}

function extractListBlock(text, label) {
  const re = new RegExp(
    `(?:^|\\n)\\s*${label}\\s*:?\\s*\\n([\\s\\S]*?)(?=\\n\\s*(?:Includes?|Excludes?|Subheading|Heading|Related|\\d+\\.\\s*[-–—])|$)`,
    "i",
  );
  const m = text.match(re);
  if (!m) return [];
  return m[1]
    .split(/\n/)
    .map((l) => l.replace(/^[\s•\-–(a-z)]+/i, "").trim())
    .filter((l) => l.length > 2);
}

function extractRelatedHeadings(text) {
  const related = new Set();
  const re = /heading\s+(\d{2}\.\d{2})/gi;
  let m;
  while ((m = re.exec(text))) related.add(m[1]);
  return [...related];
}

function parseChapterNotes(fullText, chapterNum, firstHeadingIdx) {
  const end = firstHeadingIdx > 0 ? firstHeadingIdx : fullText.length;
  const block = fullText.slice(0, end);
  const notes = [];
  const lines = block.split(/\n/);
  let buf = "";
  let num = "";

  for (const line of lines) {
    const noteStart = line.match(/^\s*(\d+)\s*\.?\s*[-–—]\s*(.*)/);
    if (noteStart) {
      if (buf && num) notes.push({ number: num, text: buf.trim() });
      num = noteStart[1];
      buf = noteStart[2];
    } else if (buf) {
      buf += `\n${line}`;
    }
  }
  if (buf && num) notes.push({ number: num, text: buf.trim() });

  const generalMatch = block.match(
    /(?:General|GENERAL)\s*(?:notes?)?\s*[.:]?\s*\n([\s\S]*?)(?=\n\s*\d+\s*\.?\s*[-–—]|\n\s*Heading|\n\s*\d{2}\.\d{2}|$)/i,
  );
  const general = generalMatch ? generalMatch[1].trim() : "";

  return {
    chapter: chapterNum,
    chapter_notes: notes,
    general_notes: general,
    section_notes: extractSectionNotes(block),
  };
}

function extractSectionNotes(block) {
  const m = block.match(
    /(?:Section|SECTION)\s+([IVXLC\d]+)\s*[.:]?\s*\n([\s\S]*?)(?=\n\s*(?:CHAPTER|Chapter)\s+\d|$)/i,
  );
  return m ? [{ section: m[1], text: m[2].trim() }] : [];
}

function splitByHeadings(fullText, chapterNum) {
  const headingStarts = [];
  const re = /(?:^|\n)\s*(?:Heading\s+)?(\d{2})\.(\d{2})\s*[-–—]?\s*([^\n]+)/gi;
  let m;
  while ((m = re.exec(fullText))) {
    const code = normalizeHeadingCode(m[1], m[2]);
    if (m[1] !== chapterNum && m[1] !== String(parseInt(chapterNum, 10))) {
      continue;
    }
    headingStarts.push({
      code,
      title: m[3].trim(),
      index: m.index,
      matchLen: m[0].length,
    });
  }

  const headings = [];
  for (let i = 0; i < headingStarts.length; i++) {
    const start = headingStarts[i];
    const end = i + 1 < headingStarts.length ? headingStarts[i + 1].index : fullText.length;
    const body = fullText.slice(start.index + start.matchLen, end).trim();

    const subheadings = [];
    const subRe = /(?:^|\n)\s*(?:Subheading\s+)?(\d{2})(\d{2})\.(\d{2})\s*[-–—]?\s*([^\n]+)/gi;
    let sm;
    while ((sm = subRe.exec(body))) {
      if (sm[1] + sm[2] !== start.code.replace(".", "")) continue;
      subheadings.push({
        code: `${sm[1]}${sm[2]}.${sm[3]}`,
        title: sm[4].trim(),
      });
    }

    const includes = extractListBlock(body, "Includes?");
    const excludes = extractListBlock(body, "Excludes?");
    const related = extractRelatedHeadings(body).filter((h) => h !== start.code);

    headings.push({
      code: start.code,
      title: start.title,
      explanatory_note: body,
      includes,
      excludes,
      subheadings,
      related_headings: related,
      keywords: extractKeywords(`${start.title} ${body}`),
    });
  }

  return headings;
}

function pageMapForHeadings(pages, fullText, headings) {
  let offset = 0;
  const pageEnds = pages.map((p) => {
    offset += p.text.length + 2;
    return { page: p.pageNumber, endOffset: offset };
  });

  function pageAt(charIdx) {
    for (const pe of pageEnds) {
      if (charIdx < pe.endOffset) return pe.page;
    }
    return pages[pages.length - 1]?.pageNumber ?? 1;
  }

  for (const h of headings) {
    const idx = fullText.search(
      new RegExp(`(?:Heading\\s+)?${h.code.replace(".", "\\.")}\\s*[-–—]?`, "i"),
    );
    h.source_pages = idx >= 0 ? [pageAt(idx)] : [pages[0]?.pageNumber ?? 1];
  }
  return headings;
}

export function parseChapterFromPages(chapterNum, pages, sourcePdf) {
  const fullText = pages.map((p) => p.text).join("\n\n");
  const { chapterTitle, firstHeading } = findSectionBounds(fullText);
  const meta = parseChapterNotes(fullText, chapterNum, firstHeading);

  let headings = splitByHeadings(fullText, chapterNum);
  headings = pageMapForHeadings(pages, fullText, headings);

  for (const h of headings) {
    h.source_pdf = sourcePdf;
  }

  return {
    chapter: chapterNum,
    chapter_title: chapterTitle,
    section_notes: meta.section_notes,
    chapter_notes: meta.chapter_notes,
    general_notes: meta.general_notes,
    headings,
    full_text: fullText,
  };
}

export function headingFileSlug(code) {
  return `heading-${code.replace(".", "")}`;
}
