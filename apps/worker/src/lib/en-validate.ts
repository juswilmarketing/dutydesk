/**
 * Explanatory Notes retrieval — VALIDATION ONLY.
 *
 * Never use this for unrestricted global semantic search to find products/chapters.
 * Call only after chapter gating + heading candidate selection.
 */
export type EnChunk = {
  id: number;
  chapter: string | null;
  heading: string | null;
  subheading: string | null;
  section: string | null;
  chunk_text: string;
  keywords: string | null;
};

export type EnValidationResult = {
  heading: string;
  hs_code: string;
  status: "included" | "excluded" | "neutral" | "unavailable";
  noteExcerpt?: string;
  chunksRetrieved: number;
};

function headingKey(hs: string): string {
  const d = hs.replace(/\D/g, "");
  return `${d.slice(0, 2)}.${d.slice(2, 4)}`;
}

function scoreInclusion(text: string, productBlob: string): "included" | "excluded" | "neutral" {
  const t = text.toLowerCase();
  const p = productBlob.toLowerCase();
  if (/\bexclud(e|es|ed|ing)\b/.test(t) && /\b(metal polish|polish(?:es)?|cleaning preparation)\b/.test(p)) {
    if (/\bmetal polish(?:es)?\b/.test(t) && /\bexclud/.test(t)) return "excluded";
  }
  if (/\binclud(e|es|ed|ing)\b/.test(t) || /\bthis heading covers\b/.test(t)) {
    if (/metal polish|polishes and similar|scouring|cleaning preparation|creams for/.test(t)) {
      return "included";
    }
  }
  if (/does not cover|are excluded|excluded from this heading/.test(t)) {
    // Only mark excluded if product terms appear near exclusion language
    const productTerms = p.split(/\s+/).filter((w) => w.length > 3).slice(0, 6);
    if (productTerms.some((term) => t.includes(term))) return "excluded";
  }
  return "neutral";
}

/**
 * Retrieve EN chunks only for candidate headings (max 3 headings × 2 chunks + chapter note).
 */
export async function validateCandidatesWithExplanatoryNotes(
  db: D1Database,
  candidates: Array<{ hs_code: string; heading: string; title: string }>,
  productDescription: string,
  predictedChapter: string | null,
): Promise<{ validations: EnValidationResult[]; chunksRetrieved: number; excerptsForPrompt: string[] }> {
  const top = candidates.slice(0, 3);
  if (!top.length) {
    return { validations: [], chunksRetrieved: 0, excerptsForPrompt: [] };
  }

  const validations: EnValidationResult[] = [];
  const excerptsForPrompt: string[] = [];
  let chunksRetrieved = 0;

  for (const cand of top) {
    const heading = cand.heading || headingKey(cand.hs_code);
    const chapter = (predictedChapter || heading.slice(0, 2)).padStart(2, "0");
    const headingDigits = heading.replace(/\D/g, "").slice(0, 4);

    try {
      const rows = await db
        .prepare(
          `SELECT id, chapter, heading, subheading, section, chunk_text, keywords
           FROM explanatory_note_chunks
           WHERE (
             REPLACE(COALESCE(heading,''), '.', '') LIKE ? OR
             (chapter = ? AND (heading IS NULL OR heading = '' OR section LIKE '%chapter%'))
           )
           ORDER BY
             CASE WHEN REPLACE(COALESCE(heading,''), '.', '') LIKE ? THEN 0 ELSE 1 END,
             chunk_index ASC
           LIMIT 2`,
        )
        .bind(`${headingDigits}%`, chapter, `${headingDigits}%`)
        .all<EnChunk>();

      const chunks = rows.results || [];
      chunksRetrieved += chunks.length;

      if (!chunks.length) {
        validations.push({
          heading,
          hs_code: cand.hs_code,
          status: "unavailable",
          chunksRetrieved: 0,
        });
        continue;
      }

      let status: EnValidationResult["status"] = "neutral";
      const combined = chunks.map((c) => c.chunk_text).join("\n");
      status = scoreInclusion(combined, `${productDescription} ${cand.title}`);
      const excerpt = combined.slice(0, 400);
      validations.push({
        heading,
        hs_code: cand.hs_code,
        status,
        noteExcerpt: excerpt,
        chunksRetrieved: chunks.length,
      });
      excerptsForPrompt.push(
        `EN for ${heading} (${status}): ${excerpt.replace(/\s+/g, " ").slice(0, 280)}`,
      );
    } catch {
      validations.push({
        heading,
        hs_code: cand.hs_code,
        status: "unavailable",
        chunksRetrieved: 0,
      });
    }
  }

  // One chapter-note chunk if available
  if (predictedChapter) {
    try {
      const ch = predictedChapter.padStart(2, "0");
      const chapterNote = await db
        .prepare(
          `SELECT chunk_text FROM explanatory_note_chunks
           WHERE chapter = ? AND (section LIKE '%chapter%' OR heading IS NULL OR heading = '')
           ORDER BY chunk_index ASC LIMIT 1`,
        )
        .bind(ch)
        .first<{ chunk_text: string }>();
      if (chapterNote?.chunk_text) {
        chunksRetrieved += 1;
        excerptsForPrompt.push(
          `Chapter ${ch} note: ${chapterNote.chunk_text.replace(/\s+/g, " ").slice(0, 220)}`,
        );
      }
    } catch {
      /* EN table may be empty */
    }
  }

  return { validations, chunksRetrieved, excerptsForPrompt };
}
