import { chapterTitle } from "./chapter-titles";
import { digitsOnly, parseTariffCode, normalizeTariffCode } from "./code";
import { getTariffRows, type TariffRow } from "./rows";
import { hasTokenMatch, scoreTariffDescription } from "./search";

export type TariffChapterNode = {
  chapter: string;
  title: string;
  lineCount: number;
  sampleDescriptions: string[];
};

export type TariffHeadingNode = {
  chapter: string;
  heading: string;
  headingDisplay: string;
  title: string;
  lineCount: number;
  lines: TariffRow[];
};

export type TariffHealthIssue = {
  code: string;
  issue: string;
};

export type TariffHealthReport = {
  totalLines: number;
  chapterCount: number;
  headingCount: number;
  validFormatCount: number;
  missingDescription: number;
  missingDuty: number;
  duplicateCodes: number;
  orphanedByFormat: number;
  issues: TariffHealthIssue[];
  generatedAt: string;
};

type HierarchyIndex = {
  byCode: Map<string, TariffRow>;
  byDigits: Map<string, TariffRow>;
  chapters: Map<string, TariffChapterNode>;
  headings: Map<string, TariffHeadingNode>;
  linesByChapter: Map<string, TariffRow[]>;
  linesByHeading: Map<string, TariffRow[]>;
};

let cached: HierarchyIndex | null = null;

function buildHeadingTitle(lines: TariffRow[]): string {
  // Prefer longest non-"Other" description as heading proxy
  const ranked = [...lines].sort((a, b) => {
    const aOther = /^other\b/i.test(a.desc) ? 1 : 0;
    const bOther = /^other\b/i.test(b.desc) ? 1 : 0;
    if (aOther !== bOther) return aOther - bOther;
    return b.desc.length - a.desc.length;
  });
  return ranked[0]?.desc?.slice(0, 120) || "Heading";
}

function buildIndex(): HierarchyIndex {
  const rows = getTariffRows();
  const byCode = new Map<string, TariffRow>();
  const byDigits = new Map<string, TariffRow>();
  const linesByChapter = new Map<string, TariffRow[]>();
  const linesByHeading = new Map<string, TariffRow[]>();

  for (const row of rows) {
    const parsed = parseTariffCode(row.code);
    byCode.set(row.code, row);
    byCode.set(parsed.national, row);
    byDigits.set(parsed.digits, row);
    const chList = linesByChapter.get(parsed.chapter) || [];
    chList.push(row);
    linesByChapter.set(parsed.chapter, chList);
    const hList = linesByHeading.get(parsed.heading) || [];
    hList.push(row);
    linesByHeading.set(parsed.heading, hList);
  }

  const chapters = new Map<string, TariffChapterNode>();
  for (const [chapter, lines] of linesByChapter) {
    chapters.set(chapter, {
      chapter,
      title: chapterTitle(chapter),
      lineCount: lines.length,
      sampleDescriptions: lines.slice(0, 8).map((l) => l.desc),
    });
  }

  const headings = new Map<string, TariffHeadingNode>();
  for (const [heading, lines] of linesByHeading) {
    const chapter = heading.slice(0, 2);
    headings.set(heading, {
      chapter,
      heading,
      headingDisplay: `${heading.slice(0, 2)}.${heading.slice(2, 4)}`,
      title: buildHeadingTitle(lines),
      lineCount: lines.length,
      lines,
    });
  }

  return { byCode, byDigits, chapters, headings, linesByChapter, linesByHeading };
}

export function getHierarchyIndex(): HierarchyIndex {
  if (!cached) cached = buildIndex();
  return cached;
}

export function getNationalLine(code: string): TariffRow | null {
  const idx = getHierarchyIndex();
  const parsed = parseTariffCode(code);
  return idx.byCode.get(code) || idx.byCode.get(parsed.national) || idx.byDigits.get(parsed.digits) || null;
}

export function getChapter(chapter: string): TariffChapterNode | null {
  return getHierarchyIndex().chapters.get(chapter.padStart(2, "0")) || null;
}

export function getHeading(heading: string): TariffHeadingNode | null {
  const h = digitsOnly(heading).slice(0, 4).padStart(4, "0");
  return getHierarchyIndex().headings.get(h) || null;
}

export function getNationalLinesForHeading(heading: string): TariffRow[] {
  const h = digitsOnly(heading).slice(0, 4).padStart(4, "0");
  return getHierarchyIndex().linesByHeading.get(h) || [];
}

export function getNationalLinesForChapter(chapter: string): TariffRow[] {
  return getHierarchyIndex().linesByChapter.get(chapter.padStart(2, "0")) || [];
}

export function listChapters(): TariffChapterNode[] {
  return [...getHierarchyIndex().chapters.values()].sort((a, b) => a.chapter.localeCompare(b.chapter));
}

function tokenize(q: string): string[] {
  return q
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

/** Score a chapter using title + sample national descriptions. */
export function scoreChapter(
  chapter: string,
  query: string,
  boost = 0,
): { chapter: string; title: string; score: number } {
  const node = getChapter(chapter);
  if (!node) return { chapter: chapter.padStart(2, "0"), title: chapterTitle(chapter), score: boost };
  const blob = `${node.title} ${node.sampleDescriptions.join(" ")}`;
  const terms = tokenize(query);
  let score = boost;
  for (const t of terms) {
    if (hasTokenMatch(blob, t)) score += 2;
  }
  score += scoreTariffDescription(blob, terms, { phrase: query }) * 0.15;
  return { chapter: node.chapter, title: node.title, score };
}

export function searchHeadingsInChapters(
  query: string,
  chapters: string[],
  limit = 10,
): Array<{ heading: string; headingDisplay: string; title: string; chapter: string; score: number; lines: TariffRow[] }> {
  const terms = tokenize(query);
  const allowed = new Set(chapters.map((c) => c.padStart(2, "0")));
  const out: Array<{ heading: string; headingDisplay: string; title: string; chapter: string; score: number; lines: TariffRow[] }> = [];

  for (const node of getHierarchyIndex().headings.values()) {
    if (allowed.size && !allowed.has(node.chapter)) continue;
    const blob = `${node.title} ${node.lines.map((l) => l.desc).join(" ")}`;
    let score = scoreTariffDescription(blob, terms, { phrase: query });
    if (score <= 0) {
      // Still allow weak chapter-membership candidates with tiny score if query empty of hits
      continue;
    }
    out.push({
      heading: node.heading,
      headingDisplay: node.headingDisplay,
      title: node.title,
      chapter: node.chapter,
      score,
      lines: node.lines,
    });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}

export function searchNationalInHeadings(
  query: string,
  headings: string[],
  limit = 12,
): Array<TariffRow & { score: number; heading: string; chapter: string }> {
  const terms = tokenize(query);
  const allowed = new Set(headings.map((h) => digitsOnly(h).slice(0, 4).padStart(4, "0")));
  const out: Array<TariffRow & { score: number; heading: string; chapter: string }> = [];

  for (const heading of allowed) {
    const lines = getNationalLinesForHeading(heading);
    for (const row of lines) {
      const parsed = parseTariffCode(row.code);
      let score = scoreTariffDescription(row.desc, terms, { phrase: query });
      // Prefer specific lines over bare "Other"
      if (/^other\b/i.test(row.desc)) score *= 0.55;
      if (score <= 0) continue;
      out.push({ ...row, score, heading: parsed.heading, chapter: parsed.chapter });
    }
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}

export function buildTariffHealthReport(): TariffHealthReport {
  const rows = getTariffRows();
  const idx = getHierarchyIndex();
  const issues: TariffHealthIssue[] = [];
  let missingDescription = 0;
  let missingDuty = 0;
  let validFormatCount = 0;
  const seen = new Map<string, number>();

  for (const row of rows) {
    const parsed = parseTariffCode(row.code);
    if (parsed.validFormat) validFormatCount += 1;
    else {
      issues.push({ code: row.code, issue: "malformed_code" });
    }
    if (!row.desc?.trim()) {
      missingDescription += 1;
      issues.push({ code: row.code, issue: "missing_description" });
    }
    if (row.duty == null || String(row.duty).trim() === "") {
      missingDuty += 1;
      issues.push({ code: row.code, issue: "missing_duty" });
    }
    const key = parsed.digits;
    seen.set(key, (seen.get(key) || 0) + 1);
  }

  let duplicateCodes = 0;
  for (const [digits, count] of seen) {
    if (count > 1) {
      duplicateCodes += 1;
      issues.push({ code: digits, issue: `duplicate_code_count_${count}` });
    }
  }

  const orphanedByFormat = rows.length - validFormatCount;

  return {
    totalLines: rows.length,
    chapterCount: idx.chapters.size,
    headingCount: idx.headings.size,
    validFormatCount,
    missingDescription,
    missingDuty,
    duplicateCodes,
    orphanedByFormat,
    issues: issues.slice(0, 200),
    generatedAt: new Date().toISOString(),
  };
}

export { normalizeTariffCode, parseTariffCode };
