import type {
  BrandDictionaryEntry,
  ChapterPredictionRuleEntry,
  HeadingCandidate,
  ProductDictionaryEntry,
  ProductPrediction,
  ProductProfile,
} from "@pas/shared-types";
import { getTariffRows } from "@pas/tariff-data";
import {
  detectProductDomain,
  applyDomainToProfile,
  isFoodChapter,
  type DomainSignal,
  DOMAIN_LABELS,
} from "./domain";

function chapterTitle(chapter: string): string {
  const rows = getTariffRows();
  const hit = rows.find((r) => r.code.replace(/\D/g, "").startsWith(chapter));
  return hit?.desc?.slice(0, 80) ?? `Chapter ${chapter}`;
}

const GENERIC_TOKENS = new Set([
  "and",
  "the",
  "for",
  "with",
  "from",
  "other",
  "type",
  "grade",
  "based",
  "preparation",
  "preparations",
  "paste",
  "cream",
  "creams",
  "solution",
  "treated",
  "preserved",
  "similar",
  "including",
  "whether",
  "not",
]);

function meaningfulTokens(blob: string): string[] {
  return blob
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !GENERIC_TOKENS.has(t));
}

export function predictChapter(
  profile: ProductProfile,
  rules: ChapterPredictionRuleEntry[],
  dictionaryHit: ProductDictionaryEntry | null,
  brandHit: BrandDictionaryEntry | null,
  domainSignal?: DomainSignal,
): { chapter: string | null; confidence: number; title: string | null; scores: Map<string, number> } {
  const scores = new Map<string, number>();
  const signal = domainSignal ?? detectProductDomain(profile.normalizedName || profile.productName, profile);

  const add = (chapter: string | null | undefined, weight: number) => {
    if (!chapter) return;
    const ch = chapter.padStart(2, "0");
    // Hard gate: never let food chapters score for non-food domains
    if (signal.domain !== "food" && signal.confidence >= 0.55 && isFoodChapter(ch)) {
      return;
    }
    if (signal.excludedChapters.includes(ch) && signal.confidence >= 0.55) {
      scores.set(ch, Math.min(scores.get(ch) || 0, 0.05));
      return;
    }
    scores.set(ch, (scores.get(ch) || 0) + weight);
  };

  // Domain-first chapter seeding (before dictionary/brand so EN-like free text never opens ch 20)
  for (const ch of signal.likelyChapters) {
    add(ch, 4 * signal.confidence);
  }

  if (dictionaryHit?.typical_chapter) add(dictionaryHit.typical_chapter, 3);
  if (brandHit) {
    // Brand chapters only if they don't violate domain gate
    brandHit.typical_chapters.forEach((c) => {
      const ch = c.padStart(2, "0");
      if (signal.domain !== "food" && isFoodChapter(ch) && signal.confidence >= 0.55) return;
      if (signal.likelyChapters.length && !signal.likelyChapters.includes(ch) && signal.confidence >= 0.8) {
        add(c, brandHit.confidence_boost * 3); // reduced when domain is confident
      } else {
        add(c, brandHit.confidence_boost * 10);
      }
    });
  }

  for (const rule of rules) {
    if (rule.status !== "active") continue;
    let match = false;
    if (rule.industry_code && rule.industry_code === profile.industryCode) match = true;
    if (rule.product_family && rule.product_family === profile.productFamily) match = true;
    if (rule.material && profile.material && profile.material.includes(rule.material)) match = true;
    if (rule.function_key && profile.primaryUse?.toLowerCase().includes(rule.function_key)) match = true;
    if (match) add(rule.chapter, rule.weight);
  }

  if (!scores.size && profile.industryCode) {
    if (profile.footwear) add("64", 1);
    if (profile.food && signal.domain === "food") add("20", 0.8);
    if (profile.electrical) add("85", 1);
    if (profile.construction) add("39", 0.7);
    if (profile.vehicle) add("87", 0.8);
    if (profile.industryCode === "printing" || /print|ribbon|toner|ink cartridge/i.test(profile.normalizedName)) {
      add("84", 2.5);
      add("96", 1.5);
    }
    if (profile.industryCode === "chemicals" || profile.chemical) add("34", 2);
  }

  // Strong override: printing consumables
  if (
    profile.industryCode === "printing" ||
    profile.productFamily === "Printing Consumable" ||
    /ymcko|printer ribbon|toner|ink cartridge|ribbon cartridge/i.test(
      `${profile.normalizedName} ${profile.productType || ""} ${profile.productFamily || ""}`,
    )
  ) {
    add("84", 4);
    add("96", 2.5);
    if (scores.has("40")) scores.set("40", Math.min(scores.get("40") || 0, 0.2));
    if (scores.has("87") && profile.industryCode === "printing") {
      scores.set("87", Math.min(scores.get("87") || 0, 0.2));
    }
  }

  // Metal polish / cleaning prep → Chapter 34 hard boost + suppress food
  if (signal.domain === "chemicals" && signal.likelyChapters.includes("34")) {
    add("34", 6);
    for (const ch of signal.excludedChapters) {
      if (scores.has(ch)) scores.set(ch, Math.min(scores.get(ch) || 0, 0.05));
    }
  }

  // Wrong-domain near-zero
  if (signal.confidence >= 0.7 && signal.domain !== "unknown") {
    for (const [ch, score] of [...scores.entries()]) {
      if (signal.excludedChapters.includes(ch)) {
        scores.set(ch, Math.min(score, 0.05));
      }
    }
  }

  let best: string | null = null;
  let bestScore = 0;
  let total = 0;
  for (const [ch, score] of scores) {
    total += score;
    if (score > bestScore) {
      bestScore = score;
      best = ch;
    }
  }

  const confidence = total ? Math.min(0.95, bestScore / total + (dictionaryHit ? 0.15 : 0) + signal.confidence * 0.1) : 0;
  return {
    chapter: best,
    confidence: Math.round(confidence * 1000) / 1000,
    title: best ? chapterTitle(best) : null,
    scores,
  };
}

/**
 * Score heading titles within gated chapters only.
 * Explanatory Notes are NOT used here — validation happens later.
 */
export function predictHeadings(
  profile: ProductProfile,
  chapter: string | null,
  limit = 5,
  extraChapters: string[] = [],
): HeadingCandidate[] {
  const chapters = new Set<string>();
  if (chapter) chapters.add(chapter.padStart(2, "0"));
  for (const c of extraChapters) chapters.add(c.padStart(2, "0"));
  if (!chapters.size) return [];

  const rows = getTariffRows();
  const blob = `${profile.normalizedName} ${profile.productType || ""} ${profile.productFamily || ""} ${profile.primaryFunction || ""} ${profile.primaryUse || ""}`;
  const tokens = meaningfulTokens(blob);

  const printBoost =
    profile.industryCode === "printing" ||
    profile.productFamily === "Printing Consumable" ||
    /ymcko|ribbon|toner|cartridge|printer|print/.test(blob.toLowerCase());

  const polishBoost =
    /polish|restorer|scouring|cleaning preparation/i.test(blob) ||
    /metal polishing/i.test(profile.productType || "");

  const scored: HeadingCandidate[] = [];
  for (const row of rows) {
    const digits = row.code.replace(/\D/g, "");
    const rowChapter = digits.slice(0, 2);
    if (![...chapters].some((ch) => digits.startsWith(ch))) continue;

    // Extra safety: never surface food lines for chemical polish profiles
    if (profile.chemical && !profile.food && isFoodChapter(rowChapter)) continue;

    const heading = `${digits.slice(0, 2)}.${digits.slice(2, 4)}`;
    const desc = row.desc.toLowerCase();
    let score = 0.1;

    // Product identity / name — whole-token matches only
    let identityHits = 0;
    for (const t of tokens) {
      const escaped = t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (new RegExp(`(?:^|[^a-z0-9])${escaped}(?:[^a-z0-9]|$)`).test(desc)) {
        score += 0.2;
        identityHits += 1;
      }
    }
    if (profile.normalizedName && desc.includes(profile.normalizedName.toLowerCase())) score += 0.35;

    // Primary function / family
    if (profile.primaryFunction && desc.includes(profile.primaryFunction.toLowerCase().split(/\s+/)[0])) {
      score += 0.15;
    }
    if (profile.productFamily && /polish|clean|chemical/i.test(profile.productFamily) && /polish|clean|cream|scour/i.test(desc)) {
      score += 0.25;
    }

    if (printBoost) {
      if (/print|printing|ink|ribbon|toner|cartridge|accessory|apparatus/.test(desc)) score += 0.45;
      if (/tyre|tire|pneumatic|lorries|buses|rubber/.test(desc)) score *= 0.05;
    }

    if (polishBoost) {
      const isMetalPolishLine = /\bmetal polishes\b/i.test(desc) && !/other than metal polish/i.test(desc);
      const excludesMetal = /other than metal polish/i.test(desc);
      if (isMetalPolishLine) score += 1.5;
      if (excludesMetal) score *= 0.15;
      if (/polishes and similar|polishes, creams|scouring paste|footwear or furniture/.test(desc)) {
        score += 0.35;
      }
      if (heading === "34.05") score += 0.4;
      if (/^3405\.90/.test(row.code)) score += 1.0;
      if (/coachwork|footwear or furniture|floors/.test(desc) && !isMetalPolishLine) score *= 0.65;
      if (heading === "34.04") score *= 0.45;
      if (/vegetable|fruit|tomato|bean|prepared food|preserved/.test(desc)) score *= 0.05;
    }

    // Chapter fit bonus
    if (chapter && rowChapter === chapter.padStart(2, "0")) score += 0.15;

    // Weak generic-only matches stay low
    if (identityHits === 0 && !polishBoost && !printBoost) score *= 0.4;

    scored.push({
      hs_code: row.code,
      heading,
      title: row.desc,
      score, // keep uncapped for ranking; clamp when returning
      duty_rate: row.duty,
    });
  }

  scored.sort((a, b) => b.score - a.score);

  const byHeading = new Map<string, HeadingCandidate>();
  for (const c of scored) {
    const existing = byHeading.get(c.heading);
    if (!existing || c.score > existing.score) byHeading.set(c.heading, c);
  }

  // Drop near-base scores with no meaningful identity — avoid arbitrary chapter dumps
  const MIN_HEADING_SCORE = 0.28;
  return [...byHeading.values()]
    .filter((c) => c.score >= MIN_HEADING_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((c) => ({ ...c, score: Math.min(1, c.score) }));
}

/** Global lexical challengers outside the gated chapter set. */
export function predictHeadingsGlobal(
  profile: ProductProfile,
  limit = 5,
  excludedChapters: string[] = [],
): HeadingCandidate[] {
  const rows = getTariffRows();
  const blob = `${profile.normalizedName} ${profile.productType || ""} ${profile.productFamily || ""} ${profile.primaryFunction || ""} ${profile.primaryUse || ""}`;
  const tokens = meaningfulTokens(blob);
  if (!tokens.length) return [];

  const excluded = new Set(excludedChapters.map((c) => c.padStart(2, "0")));
  const scored: HeadingCandidate[] = [];

  for (const row of rows) {
    const digits = row.code.replace(/\D/g, "");
    const rowChapter = digits.slice(0, 2).padStart(2, "0");
    if (excluded.has(rowChapter)) continue;
    if (profile.chemical && !profile.food && isFoodChapter(rowChapter)) continue;

    const heading = `${digits.slice(0, 2)}.${digits.slice(2, 4)}`;
    const desc = row.desc.toLowerCase();
    let score = 0;
    let identityHits = 0;
    for (const t of tokens) {
      const escaped = t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (new RegExp(`(?:^|[^a-z0-9])${escaped}(?:[^a-z0-9]|$)`).test(desc)) {
        score += 0.25;
        identityHits += 1;
      }
    }
    if (identityHits === 0) continue;
    if (profile.normalizedName) {
      const name = profile.normalizedName.toLowerCase();
      if (desc.includes(name)) score += 0.35;
    }

    scored.push({
      hs_code: row.code,
      heading,
      title: row.desc,
      score,
      duty_rate: row.duty,
    });
  }

  scored.sort((a, b) => b.score - a.score);
  const byHeading = new Map<string, HeadingCandidate>();
  for (const c of scored) {
    const existing = byHeading.get(c.heading);
    if (!existing || c.score > existing.score) byHeading.set(c.heading, c);
  }

  return [...byHeading.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((c) => ({ ...c, score: Math.min(1, c.score) }));
}

export function buildPrediction(
  profile: ProductProfile,
  rules: ChapterPredictionRuleEntry[],
  dictionaryHit: ProductDictionaryEntry | null,
  brandHit: BrandDictionaryEntry | null,
): ProductPrediction & { domainSignal: DomainSignal; gatedProfile: ProductProfile } {
  const domainSignal = detectProductDomain(profile.normalizedName || profile.productName, profile);
  const gatedProfile = applyDomainToProfile(profile, domainSignal);
  const chapter = predictChapter(gatedProfile, rules, dictionaryHit, brandHit, domainSignal);

  // Search primary chapter + up to 2 adjacent likely chapters (still domain-gated)
  const extra = domainSignal.likelyChapters
    .filter((c) => c !== chapter.chapter)
    .slice(0, 2);

  let headings = predictHeadings(gatedProfile, chapter.chapter, 5, extra);

  // Global challengers: if they clearly beat domain-gated candidates, widen the set
  const global = predictHeadingsGlobal(
    gatedProfile,
    5,
    domainSignal.excludedChapters,
  );
  const bestDomain = headings[0]?.score ?? 0;
  const bestGlobal = global[0]?.score ?? 0;
  if (global.length && bestGlobal >= bestDomain + 0.15) {
    const seen = new Set(headings.map((h) => h.heading));
    const merged = [...headings];
    for (const g of global) {
      if (seen.has(g.heading)) continue;
      merged.push(g);
      seen.add(g.heading);
    }
    headings = merged.sort((a, b) => b.score - a.score).slice(0, 5);
  }

  const top = headings[0];

  return {
    chapter: chapter.chapter,
    chapterConfidence: chapter.confidence,
    chapterTitle: chapter.title,
    headings,
    subheading: top?.hs_code ?? null,
    predictedHsCode: top && top.score >= 0.45 ? top.hs_code : null,
    predictedDuty: top?.duty_rate ?? null,
    domain: domainSignal.domain,
    domainLabel: DOMAIN_LABELS[domainSignal.domain],
    domainConfidence: domainSignal.confidence,
    allowedChapters: domainSignal.likelyChapters,
    excludedChapters: domainSignal.excludedChapters.slice(0, 30),
    domainSignal,
    gatedProfile,
  };
}
