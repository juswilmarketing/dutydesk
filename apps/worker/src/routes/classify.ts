import { Hono } from "hono";
import type { Env, AppVariables } from "../env";
import { anthropicMessages } from "../lib/anthropic";
import { audit } from "../lib/utils";
import { compactLiquidForAi } from "@pas/product-intelligence";
import { validateCandidatesWithExplanatoryNotes } from "../lib/en-validate";
import type {
  HeadingCandidate,
  LiquidCompositionConfidences,
  LiquidProductProfile,
  ProductProfile,
} from "@pas/shared-types";

const classify = new Hono<{ Bindings: Env; Variables: AppVariables }>();

const VALIDATE_INSTRUCTION = `You are validating HS tariff classification for Trinidad & Tobago (CARICOM CET).
You must choose ONLY from the provided heading candidates. Do not invent codes outside the candidate list.
Use the structured Product Profile and, when present, the compact Liquid Composition profile (composition, concentrations, essential character, intended use).
When Explanatory Note excerpts are provided, use them ONLY to confirm inclusions/exclusions among the given candidates — never to invent a new chapter or heading.
Never assume a liquid's HS code from commercial name alone — composition and function matter.
Do not select food chapters (01–24) for industrial polishing, cleaning, chemical, electrical, mechanical, textile, or automotive articles.
Return compact JSON only.`;

type BatchItem = {
  line_id: number;
  description: string;
  product_profile?: ProductProfile;
  chapter_prediction?: string | null;
  heading_candidates?: HeadingCandidate[];
  brand?: string | null;
  industry?: string | null;
  product_family?: string | null;
  part_number?: string;
  model_number?: string;
  liquid_profile?: LiquidProductProfile;
  liquid_confidences?: LiquidCompositionConfidences;
};

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function buildValidationPrompt(
  supplier: string,
  items: BatchItem[],
  enByLine?: Map<number, string[]>,
): string {
  return `${VALIDATE_INSTRUCTION}

Supplier: ${supplier || "Unknown"}

Validate ONLY these items against their candidate headings.

Items:
${JSON.stringify(
  items.map((i) => ({
    line_id: i.line_id,
    description: i.description.slice(0, 160),
    industry: i.industry ?? i.product_profile?.industry,
    product_family: i.product_family ?? i.product_profile?.productFamily,
    product_type: i.product_profile?.productType,
    normalized_name: i.product_profile?.normalizedName,
    material: i.product_profile?.material,
    function: i.product_profile?.primaryFunction,
    brand: i.brand ?? i.product_profile?.brand,
    chapter_prediction: i.chapter_prediction,
    domain: i.product_profile?.attributes?.domainLabel || i.product_profile?.attributes?.domain || null,
    liquid: i.liquid_profile
      ? compactLiquidForAi(i.liquid_profile, i.liquid_confidences ?? {
          productIdentity: 0,
          physicalForm: 0,
          compositionCompleteness: 0,
          activeIngredient: 0,
          primaryUse: 0,
          essentialCharacter: 0,
          chapterPrediction: 0,
          headingPrediction: 0,
          finalClassification: 0,
        })
      : null,
    candidates: (i.heading_candidates ?? []).slice(0, 5).map((h) => ({
      hs_code: h.hs_code,
      heading: h.heading,
      title: h.title.slice(0, 80),
      score: h.score,
    })),
    explanatory_notes_for_candidates_only: enByLine?.get(i.line_id) ?? [],
  })),
)}

Return ONLY:
{"results":[{"line_id":1,"selected_hs_code":"XXXX.XX.XX","suggested_hs_code":"XXXX.XX.XX","tariff_description":"short","confidence":0.85,"reason_short":"one line","competing_headings":["XXXX.XX.XX"],"requires_review":false,"en_validation":"included|excluded|neutral"}]}`;
}

classify.post("/", async (c) => {
  if (!c.env.ANTHROPIC_API_KEY) return c.json({ error: "AI service not configured" }, 503);

  const body = await c.req.json<{
    description?: string;
    product_profile?: ProductProfile;
    chapter_prediction?: string | null;
    heading_candidates?: HeadingCandidate[];
    liquid_profile?: LiquidProductProfile;
    liquid_confidences?: LiquidCompositionConfidences;
  }>();
  const description = body.description?.trim();
  if (!description) return c.json({ error: "Description required" }, 400);

  const candidates = body.heading_candidates ?? [];
  if (!candidates.length) {
    return c.json({ error: "heading_candidates required for AI validation" }, 400);
  }

  const prompt = buildValidationPrompt("", [
    {
      line_id: 1,
      description,
      product_profile: body.product_profile,
      chapter_prediction: body.chapter_prediction,
      heading_candidates: candidates,
      liquid_profile: body.liquid_profile,
      liquid_confidences: body.liquid_confidences,
    },
  ]);

  try {
    const text = await anthropicMessages(
      c.env.ANTHROPIC_API_KEY,
      [{ role: "user", content: prompt }],
      600,
    );
    const parsed = JSON.parse(text.replace(/```json|```/g, "").trim()) as {
      results?: Array<{
        selected_hs_code?: string;
        suggested_hs_code?: string;
        tariff_description?: string;
        confidence?: number;
        reason_short?: string;
        requires_review?: boolean;
      }>;
    };
    const r = parsed.results?.[0];
    await audit(c, "classify");
    return c.json({
      tariff_code: r?.selected_hs_code || r?.suggested_hs_code || candidates[0].hs_code,
      duty_rate: "—",
      category: r?.tariff_description || candidates[0].title,
      notes: r?.reason_short || "AI validated among predicted headings",
      reason_short: r?.reason_short,
      confidence: r?.confidence,
      requires_review: r?.requires_review ?? false,
      ai_token_estimate: estimateTokens(prompt),
    });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : "Classification failed" }, 500);
  }
});

classify.post("/batch", async (c) => {
  if (!c.env.ANTHROPIC_API_KEY) return c.json({ error: "AI service not configured" }, 503);

  const body = await c.req.json<{
    supplier_name?: string;
    items?: BatchItem[];
  }>();

  const items = (body.items ?? []).filter((i) => i.description?.trim() && (i.heading_candidates?.length ?? 0) > 0);
  if (!items.length) return c.json({ error: "No items with heading candidates to validate" }, 400);

  const compact = items.slice(0, 50);

  // EN retrieval ONLY for candidate headings (never global note search)
  const enByLine = new Map<number, string[]>();
  const chunkCounts = new Map<number, number>();
  await Promise.all(
    compact.map(async (item) => {
      const en = await validateCandidatesWithExplanatoryNotes(
        c.env.DB,
        (item.heading_candidates ?? []).slice(0, 3),
        item.description,
        item.chapter_prediction ?? null,
      );
      enByLine.set(item.line_id, en.excerptsForPrompt);
      chunkCounts.set(item.line_id, en.chunksRetrieved);
    }),
  );

  const prompt = buildValidationPrompt(body.supplier_name || "", compact, enByLine);

  try {
    const text = await anthropicMessages(
      c.env.ANTHROPIC_API_KEY,
      [{ role: "user", content: prompt }],
      1600,
    );
    const parsed = JSON.parse(text.replace(/```json|```/g, "").trim()) as {
      results?: Array<{
        line_id: number;
        selected_hs_code?: string;
        suggested_hs_code: string;
        tariff_description: string;
        confidence: number;
        reason_short: string;
        competing_headings?: string[];
        needs_review?: boolean;
        requires_review?: boolean;
        en_validation?: string;
      }>;
    };

    await audit(c, "classify_batch");

    const byId = new Map((parsed.results ?? []).map((r) => [r.line_id, r]));
    const results = compact.map((item) => {
      const r = byId.get(item.line_id);
      const fallback = item.heading_candidates![0];
      const code = r?.selected_hs_code || r?.suggested_hs_code || fallback.hs_code;
      const allowed = new Set(item.heading_candidates!.map((h) => h.hs_code));
      const safeCode = allowed.has(code) ? code : fallback.hs_code;
      const liquidReview =
        item.liquid_confidences != null && item.liquid_confidences.finalClassification < 0.7;
      const chNum = parseInt(safeCode.replace(/\D/g, "").slice(0, 2), 10);
      const foodLeak =
        Number.isFinite(chNum) &&
        chNum >= 1 &&
        chNum <= 24 &&
        Boolean(item.product_profile?.chemical) &&
        !item.product_profile?.food;
      return {
        line_id: item.line_id,
        selected_hs_code: foodLeak ? fallback.hs_code : safeCode,
        suggested_hs_code: foodLeak ? fallback.hs_code : safeCode,
        tariff_description: r?.tariff_description || fallback.title,
        confidence: foodLeak ? Math.min(r?.confidence ?? fallback.score, 0.4) : r?.confidence ?? fallback.score,
        reason_short: foodLeak
          ? "Rejected food-chapter result for chemical/cleaning product — kept chapter-gated candidate"
          : r?.reason_short || "Selected from predicted heading candidates",
        competing_headings: r?.competing_headings ?? item.heading_candidates!.slice(1, 4).map((h) => h.hs_code),
        needs_review: foodLeak || (r?.needs_review ?? r?.requires_review ?? liquidReview ?? (r?.confidence ?? 0) < 0.75),
        requires_review: foodLeak || (r?.requires_review ?? liquidReview ?? (r?.confidence ?? 0) < 0.75),
        classification_source: "ai" as const,
        ai_skipped: false,
        en_validation: r?.en_validation ?? null,
      };
    });

    return c.json({
      results,
      tokens_saved_estimate: compact.length * 220,
      items_sent: compact.length,
      ai_token_estimate: estimateTokens(prompt),
      classification_logs: compact.map((i) => ({
        line_id: i.line_id,
        path: [
          "product_identity",
          "product_profile",
          "domain_gate",
          "chapter_prediction",
          "heading_prediction",
          "en_validation",
          "ai_validation",
        ],
        ai_skipped: false,
        chunks_retrieved: chunkCounts.get(i.line_id) ?? 0,
        token_savings_estimate: 500,
      })),
    });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : "Batch classification failed" }, 500);
  }
});

export default classify;
