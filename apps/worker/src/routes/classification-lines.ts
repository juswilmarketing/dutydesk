import { Hono } from "hono";
import { getTariffRows, searchTariff, similarCodes, getNationalLine } from "@pas/tariff-data";
import type {
  ClassificationClarificationQuestion,
  ClassificationInterpretation,
  ClassificationRecommendationCandidate,
  ClassificationRecommendationResponse,
  ConfidenceLabel,
  HeadingCandidate,
  ItemExemptions,
  ProductProfile,
  SimpleRecommendationStatus,
  TaxInputs,
} from "@pas/shared-types";
import {
  classifyHierarchically,
  isNonMerchandiseLine,
  detectInvoiceLineType,
  buildProductClassificationProfile,
} from "@pas/product-intelligence";
import type { SupplierProductEvidence } from "@pas/shared-types";
import { calculateTaxes } from "@pas/tax-engine";
import type { Env, AppVariables } from "../env";
import { anthropicMessages } from "../lib/anthropic";
import { loadCommonProductEntriesFromDb } from "../lib/product-family-rules";
import { extractJsonFromModelText } from "../lib/extract-json";
import { validateCandidatesWithExplanatoryNotes } from "../lib/en-validate";
import { audit } from "../lib/utils";
import { verifyCandidateWithTtbizlink } from "../lib/ttbizlink";
import { runSupplierProductSearch } from "./supplier-search";

const lines = new Hono<{ Bindings: Env; Variables: AppVariables }>();
const tariffRows = getTariffRows();
const tariffByCode = new Map(tariffRows.map((row) => [row.code.replace(/\s/g, ""), row]));

function percent(value: string | number | null | undefined): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (!value || value === "Free" || value === "Exempt" || value === "—") return 0;
  return Number.parseFloat(value.replace("%", "")) || 0;
}

function normalizedCode(code: string): string {
  return code.replace(/\s/g, "").toUpperCase();
}

function toConfidenceLabel(score: number, provisional: boolean): ConfidenceLabel {
  if (provisional || score < 0.45) return "More Information Needed";
  if (score >= 0.8) return "Strong Match";
  if (score >= 0.6) return "Likely Match";
  return "Possible Match";
}

function mapCandidate(
  candidate: HeadingCandidate,
  reason: string,
  confidence?: number,
  provisional = false,
): ClassificationRecommendationCandidate {
  const tariff = tariffByCode.get(normalizedCode(candidate.hs_code));
  const code = tariff?.code || candidate.hs_code;
  const score = Number.isFinite(confidence) ? Number(confidence) : candidate.score || 0.4;
  return {
    code,
    description: tariff?.desc || candidate.title,
    chapter: code.replace(/\D/g, "").slice(0, 2),
    dutyRate: percent(tariff?.duty || candidate.duty_rate),
    vatRate: 12.5,
    levyRate: 0,
    reason,
    source: "ai",
    confidence: score,
    confidenceLabel: toConfidenceLabel(score, provisional),
    provisional,
  };
}

function fallbackHeadingCandidates(
  description: string,
  predictedChapter?: string | null,
): HeadingCandidate[] {
  const preferred = predictedChapter ? [predictedChapter.padStart(2, "0")] : [];
  const fromSimilar = similarCodes(description, null, 6, {
    preferredChapters: preferred,
    excludeFoodChapters: preferred.length > 0 && Number.parseInt(preferred[0], 10) > 24,
  });
  const fromSearch = searchTariff(description, 6);
  // Prefer global search first so weak preferred-chapter rows do not crowd out real hits
  const merged = [...fromSearch, ...fromSimilar];
  const seen = new Set<string>();
  const out: HeadingCandidate[] = [];
  for (const row of merged) {
    const code = normalizedCode(row.code);
    if (!code || seen.has(code)) continue;
    // Require meaningful lexical score (search/similar now return 0 without token hits)
    if ((row.score ?? 0) < 2) continue;
    seen.add(code);
    out.push({
      hs_code: row.code,
      heading: row.code.slice(0, 4),
      title: row.desc,
      score: Math.min(0.75, Math.max(0.28, (row.score || 1) / 20)),
      duty_rate: row.duty,
    });
    if (out.length >= 5) break;
  }
  return out;
}

const MIN_CANDIDATE_SCORE = 0.28;

function qualityCandidates(candidates: HeadingCandidate[]): HeadingCandidate[] {
  return candidates.filter((c) => (c.score ?? 0) >= MIN_CANDIDATE_SCORE);
}

function buildInterpretation(
  profile: ProductProfile,
  description: string,
): ClassificationInterpretation {
  const productName =
    profile.productName ||
    profile.productType ||
    profile.normalizedName ||
    description.trim().slice(0, 80);
  return {
    productName,
    productType: profile.productType || productName,
    likelyMaterial: profile.material || profile.composition || "Unknown",
    primaryFunction: profile.primaryUse || profile.primaryFunction || "Unknown",
    industry: profile.industry || profile.productFamily || "General",
  };
}

function clarificationFor(interpretation: ClassificationInterpretation): ClassificationClarificationQuestion | null {
  const materialUnknown = !interpretation.likelyMaterial
    || /^unknown$/i.test(interpretation.likelyMaterial);
  const functionUnknown = !interpretation.primaryFunction
    || /^unknown$/i.test(interpretation.primaryFunction);
  const name = interpretation.productName.toLowerCase();
  if (/towel/.test(name) && materialUnknown) {
    return {
      id: "material",
      prompt: "What material are the towels made from?",
      options: ["Cotton", "Synthetic textile", "Microfibre", "Paper", "Unknown"],
    };
  }
  if (/shower\s*cap|cap/.test(name) && materialUnknown) {
    return {
      id: "material",
      prompt: "What is the primary material?",
      options: ["Plastic", "Rubber", "Nonwoven textile", "Unknown"],
    };
  }
  if (/\b(rack|shelving|shelf|racking)\b/i.test(name) && materialUnknown) {
    return {
      id: "material",
      prompt: "What material is the rack or shelving made from?",
      options: ["Steel / metal", "Plastic", "Wood", "Mixed", "Unknown"],
    };
  }
  if (/activat|flex.?lag|chemical|solvent|adhesive|bonding/.test(name) || functionUnknown) {
    if (/activat|flex.?lag|chemical|solvent|adhesive|bonding/.test(`${name} ${interpretation.productType}`)) {
      return {
        id: "primary_use",
        prompt: "What is this activator primarily used for?",
        options: [
          "Rubber bonding",
          "Adhesive curing",
          "Surface preparation",
          "Paint or coating",
          "Other",
          "Unknown",
        ],
      };
    }
  }
  if (materialUnknown) {
    return {
      id: "material",
      prompt: "What is the primary material?",
      options: ["Cotton", "Plastic", "Rubber", "Metal", "Chemical", "Unknown"],
    };
  }
  return null;
}

function packResponse(input: {
  status: SimpleRecommendationStatus;
  interpretation: ClassificationInterpretation;
  recommendations: ClassificationRecommendationCandidate[];
  question?: ClassificationClarificationQuestion | null;
  warnings?: string[];
  supplierEvidence?: SupplierProductEvidence | null;
  supplierSearchStatus?: ClassificationRecommendationResponse["supplierSearchStatus"];
  supplierSearchNotification?: string | null;
}): ClassificationRecommendationResponse {
  const statusIsProvisional =
    input.status === "provisional" || input.status === "clarification_needed";
  // Keep candidate.provisional in lockstep with response.status (UI reads both)
  const recommendations = input.recommendations.slice(0, 3).map((candidate) => ({
    ...candidate,
    provisional: statusIsProvisional,
    confidenceLabel: candidate.confidenceLabel
      || (statusIsProvisional
        ? (candidate.confidence != null && candidate.confidence >= 0.6 ? "Likely Match" : "Possible Match")
        : toConfidenceLabel(candidate.confidence ?? 0.5, false)),
  }));
  return {
    status: input.status,
    interpretation: input.interpretation,
    recommendations,
    question: input.question ?? null,
    warnings: input.warnings || [],
    productProfile: {
      identifiedItem: input.interpretation.productType,
      material: input.interpretation.likelyMaterial,
      productFamily: input.interpretation.industry,
      primaryUse: input.interpretation.primaryFunction,
    },
    supplierEvidence: input.supplierEvidence ?? null,
    supplierSearchStatus: input.supplierSearchStatus,
    supplierSearchNotification: input.supplierSearchNotification ?? null,
    recommendedCandidate: recommendations[0] || null,
    alternatives: recommendations.slice(1),
  };
}

async function saveLine(
  db: Env["DB"],
  username: string,
  body: {
    lineId: number;
    invoiceId: string;
    originalDescription: string;
    quantity?: number;
    unitPrice?: number;
    productProfile: ProductProfile;
  },
) {
  const profile = body.productProfile;
  await db.prepare(
    `INSERT INTO classification_lines
      (line_id, invoice_id, original_description, identified_item, material, product_family,
       primary_use, brand, model_sku, quantity, unit_price, product_profile_json, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(line_id) DO UPDATE SET
       invoice_id = excluded.invoice_id,
       original_description = excluded.original_description,
       identified_item = excluded.identified_item,
       material = excluded.material,
       product_family = excluded.product_family,
       primary_use = excluded.primary_use,
       brand = excluded.brand,
       model_sku = excluded.model_sku,
       quantity = excluded.quantity,
       unit_price = excluded.unit_price,
       product_profile_json = excluded.product_profile_json,
       updated_by = excluded.updated_by,
       updated_at = datetime('now')`,
  )
    .bind(
      body.lineId,
      body.invoiceId,
      body.originalDescription,
      profile.productType || profile.productName || null,
      profile.material || profile.composition || "Unknown",
      profile.productFamily || null,
      profile.primaryUse || profile.primaryFunction || null,
      profile.brand || null,
      profile.model || profile.partNumber || null,
      body.quantity || 1,
      body.unitPrice || 0,
      JSON.stringify(profile),
      username,
    )
    .run();
}

lines.post("/register-batch", async (c) => {
  const body = await c.req.json<{
    invoiceId?: string;
    lines?: Array<{
      lineId: number;
      originalDescription: string;
      quantity: number;
      unitPrice: number;
      productProfile?: ProductProfile;
    }>;
    taxInputs?: TaxInputs;
    exchangeRate?: number;
    itemExemptions?: Record<number, ItemExemptions>;
  }>();
  if (!body.invoiceId || !body.lines?.length) {
    return c.json({ error: "Invoice id and lines are required" }, 400);
  }

  const statements = body.lines.slice(0, 250).map((line) => {
    const profile = line.productProfile;
    return c.env.DB.prepare(
      `INSERT INTO classification_lines
        (line_id, invoice_id, original_description, identified_item, material, product_family,
         primary_use, brand, model_sku, quantity, unit_price, product_profile_json,
         classification_status, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(line_id) DO UPDATE SET
         invoice_id = excluded.invoice_id,
         original_description = excluded.original_description,
         quantity = excluded.quantity,
         unit_price = excluded.unit_price,
         identified_item = COALESCE(excluded.identified_item, identified_item),
         material = COALESCE(excluded.material, material),
         product_family = COALESCE(excluded.product_family, product_family),
         primary_use = COALESCE(excluded.primary_use, primary_use),
         brand = COALESCE(excluded.brand, brand),
         model_sku = COALESCE(excluded.model_sku, model_sku),
         product_profile_json = CASE
           WHEN excluded.product_profile_json = '{}' THEN product_profile_json
           ELSE excluded.product_profile_json
         END,
         updated_by = excluded.updated_by,
         updated_at = datetime('now')`,
    ).bind(
      line.lineId,
      body.invoiceId,
      line.originalDescription,
      profile?.productType || profile?.productName || null,
      profile?.material || profile?.composition || null,
      profile?.productFamily || null,
      profile?.primaryUse || profile?.primaryFunction || null,
      profile?.brand || null,
      profile?.model || profile?.partNumber || null,
      line.quantity || 1,
      line.unitPrice || 0,
      JSON.stringify(profile || {}),
      profile ? "Suggestion Ready" : "Generating Suggestions",
      c.var.username,
    );
  });
  await c.env.DB.batch(statements);
  await c.env.DB.prepare(
    `INSERT INTO classification_worksheets
      (invoice_id, tax_inputs_json, item_exemptions_json, exchange_rate, updated_by)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(invoice_id) DO UPDATE SET
       tax_inputs_json = excluded.tax_inputs_json,
       item_exemptions_json = excluded.item_exemptions_json,
       exchange_rate = excluded.exchange_rate,
       updated_by = excluded.updated_by,
       updated_at = datetime('now')`,
  )
    .bind(
      body.invoiceId,
      JSON.stringify(body.taxInputs || {}),
      JSON.stringify(body.itemExemptions || {}),
      body.exchangeRate && body.exchangeRate > 0 ? body.exchangeRate : 6.75,
      c.var.username,
    )
    .run();
  return c.json({ success: true, registered: statements.length });
});

lines.post("/:lineId/recommendation", async (c) => {
  const lineId = Number(c.req.param("lineId"));
  if (!Number.isFinite(lineId)) return c.json({ error: "Invalid line id" }, 400);
  const body = await c.req.json<{
    invoiceId?: string;
    originalDescription?: string;
    quantity?: number;
    unitPrice?: number;
    productProfile?: ProductProfile;
    predictedChapter?: string | null;
    headingCandidates?: HeadingCandidate[];
    resolutionId?: number;
    evidenceIds?: number[];
    productMasterId?: number | null;
    clarificationAnswer?: { id: string; value: string } | null;
    consignee?: string | null;
    invoiceNotes?: string | null;
    forceSupplierSearch?: boolean;
    applySupplierEvidence?: boolean;
  }>();
  if (!body.originalDescription?.trim()) {
    return c.json({ error: "Original description is required" }, 400);
  }

  // Gate: never classify freight / surcharge / payment / total rows
  if (isNonMerchandiseLine(body.originalDescription)) {
    const typed = detectInvoiceLineType(body.originalDescription);
    const response = packResponse({
      status: "unable_to_classify",
      interpretation: {
        productName: body.originalDescription.trim().slice(0, 80),
        productType: typed.lineType,
        likelyMaterial: "N/A",
        primaryFunction: "Non-merchandise invoice line",
        industry: "N/A",
      },
      recommendations: [],
      question: null,
      warnings: [
        `Line type "${typed.lineType}" is excluded from tariff classification (${typed.reason}).`,
      ],
    });
    await c.env.DB.prepare(
      `UPDATE classification_lines
       SET classification_status = 'Needs Manual Review', updated_at = datetime('now') WHERE line_id = ?`,
    ).bind(lineId).run();
    return c.json(response);
  }

  const profile: ProductProfile = body.productProfile || {
    productName: body.originalDescription.trim().slice(0, 80),
    normalizedName: body.originalDescription.trim().toLowerCase().slice(0, 80),
    industry: null,
    industryCode: null,
    productFamily: null,
    productType: body.originalDescription.trim().slice(0, 80),
    material: "Unknown",
    composition: null,
    primaryFunction: "Unknown",
    primaryUse: "Unknown",
    commercialUse: false,
    consumerUse: false,
    brand: null,
    model: null,
    partNumber: null,
    supplier: null,
    countryOfOrigin: null,
    gender: null,
    ageGroup: null,
    food: false,
    chemical: false,
    medical: false,
    electrical: false,
    vehicle: false,
    construction: false,
    textile: false,
    footwear: false,
    machine: false,
    tool: false,
    hazardous: false,
    fragile: false,
    temperatureControlled: false,
    attributes: {},
  };

  if (body.clarificationAnswer?.id === "material" && body.clarificationAnswer.value) {
    profile.material = body.clarificationAnswer.value;
    profile.composition = body.clarificationAnswer.value;
  }
  if (body.clarificationAnswer?.id === "primary_use" && body.clarificationAnswer.value) {
    profile.primaryUse = body.clarificationAnswer.value;
    profile.primaryFunction = body.clarificationAnswer.value;
  }

  await saveLine(c.env.DB, c.var.username, {
    lineId,
    invoiceId: body.invoiceId || "unsaved",
    originalDescription: body.originalDescription,
    quantity: body.quantity,
    unitPrice: body.unitPrice,
    productProfile: profile,
  });
  await c.env.DB.prepare(
    `UPDATE classification_lines SET resolution_id = COALESCE(?, resolution_id),
     product_master_id = COALESCE(?, product_master_id),
     evidence_ids_json = ?, classification_status = 'Generating Suggestions',
     updated_at = datetime('now') WHERE line_id = ?`,
  ).bind(
    body.resolutionId || null,
    body.productMasterId || null,
    JSON.stringify(body.evidenceIds || []),
    lineId,
  ).run();

  // Initial product interpretation (cheap) — used to decide whether supplier search is needed
  const supplierName = profile.supplier || body.productProfile?.supplier || "";
  const skuHint = profile.partNumber || profile.model || null;
  const commonProductEntries = await loadCommonProductEntriesFromDb(c.env.DB);
  const initialProfile = buildProductClassificationProfile(
    body.originalDescription,
    body.clarificationAnswer || null,
    {
      supplier: supplierName,
      consignee: body.consignee || null,
      invoiceNotes: body.invoiceNotes || null,
      commonProductEntries,
    },
  );

  // Internal supplier/SKU lookup first (no web). External search only when forced or async allow.
  const supplierSearch = await runSupplierProductSearch(c.env, {
    supplier: supplierName,
    sku: skuHint || initialProfile.sku || null,
    description: body.originalDescription,
    forceSearch: Boolean(body.forceSupplierSearch),
    allowExternal: Boolean(body.forceSupplierSearch),
    profileConfidence: initialProfile.interpretationConfidence,
    productNoun: initialProfile.productNoun,
    material: initialProfile.material,
  });

  const useEvidence =
    Boolean(supplierSearch.evidence)
    && (supplierSearch.status === "exact_internal"
      || supplierSearch.status === "catalogue"
      || body.applySupplierEvidence
      || body.forceSupplierSearch);

  // Hierarchical retrieval-grounded classification (AI may only rank retrieved codes)
  const hierarchical = classifyHierarchically(
    body.originalDescription,
    body.clarificationAnswer || null,
    {
      supplier: supplierName || null,
      consignee: body.consignee || null,
      invoiceNotes: body.invoiceNotes || null,
      commonProductEntries,
      productEvidence: useEvidence && supplierSearch.evidence
        ? {
            canonicalProduct: supplierSearch.evidence.canonicalProduct,
            material: supplierSearch.evidence.material,
            primaryFunction: supplierSearch.evidence.primaryFunction,
            intendedUse: supplierSearch.evidence.intendedUse,
            emptyOrFilled: supplierSearch.evidence.emptyOrFilled,
          }
        : null,
    },
  );

  const skipAiForExactInternal =
    supplierSearch.status === "exact_internal"
    && Boolean(supplierSearch.evidence?.technicalSpecifications?.approvedTariff);

  const profileFromEngine: ProductProfile = {
    ...profile,
    productName: hierarchical.profile.canonicalProduct || profile.productName,
    productType: hierarchical.profile.canonicalProduct || profile.productType,
    normalizedName: hierarchical.profile.normalizedDescription || profile.normalizedName,
    material: hierarchical.profile.material || profile.material,
    primaryFunction: hierarchical.profile.primaryFunction || profile.primaryFunction,
    primaryUse: hierarchical.profile.intendedUse || hierarchical.profile.primaryFunction || profile.primaryUse,
    productFamily: hierarchical.profile.productFamily || profile.productFamily,
    industry: hierarchical.profile.industry || profile.industry,
    brand: hierarchical.profile.brand || profile.brand,
    partNumber: hierarchical.profile.sku || profile.partNumber,
    attributes: {
      ...profile.attributes,
      classificationProfile: JSON.stringify(hierarchical.profile),
      predictedChapters: hierarchical.chapters.map((c) => c.chapter).join(","),
      recommendationStatus: hierarchical.recommendationStatus,
    },
  };

  const interpretation: ClassificationInterpretation = {
    productName: hierarchical.profile.canonicalProduct || body.originalDescription.trim().slice(0, 80),
    // productType = identified merchandise noun; family lives on profile.productFamily
    productType: hierarchical.profile.canonicalProduct || hierarchical.profile.productNoun || "Product",
    likelyMaterial: hierarchical.profile.material || "Unknown",
    primaryFunction: hierarchical.profile.primaryFunction || "Unknown",
    industry: hierarchical.profile.productFamily || hierarchical.profile.industry || "General",
  };

  const warnings = [...hierarchical.warnings];
  const scored = hierarchical.candidates.filter((c) => Boolean(getNationalLine(c.code)));
  let candidates: HeadingCandidate[] = scored.map((c) => ({
    hs_code: c.code,
    heading: c.heading,
    title: c.description,
    score: Math.max(0.2, Math.min(0.98, c.finalScore / 100)),
    duty_rate: c.duty,
  }));

  // Never reintroduce incompatible codes when product family is known with confidence.
  const familyKnown =
    Boolean(hierarchical.profile.knownAttributes?.hardHeadingGate)
    || Number(hierarchical.profile.familyConfidence ?? hierarchical.profile.knownAttributes?.productFamilyConfidence ?? 0) >= 0.85
    || Boolean(hierarchical.profile.knownAttributes?.commonProductFastPath);

  // Legacy / catalogue fallbacks only when family is unknown (avoids showing motors for displays, etc.)
  if (!candidates.length && !familyKnown) {
    const legacy = qualityCandidates((body.headingCandidates || []).slice(0, 5));
    const legacyValid = legacy.filter((h) => Boolean(getNationalLine(h.hs_code) || tariffByCode.get(normalizedCode(h.hs_code))));
    if (legacyValid.length) {
      candidates = legacyValid;
      warnings.push("Fell back to product-intelligence headings; all codes validated against the tariff database.");
    }
  }
  if (!candidates.length && !familyKnown) {
    candidates = fallbackHeadingCandidates(body.originalDescription, hierarchical.chapters[0]?.chapter || body.predictedChapter)
      .filter((h) => Boolean(getNationalLine(h.hs_code) || tariffByCode.get(normalizedCode(h.hs_code))));
    if (candidates.length) warnings.push("Used catalogue search fallback with database-validated codes only.");
  }
  if (!candidates.length && familyKnown) {
    warnings.push("No reliable tariff match for the identified product family — refusing unrelated suggestions.");
  }

  console.log("[classification]", JSON.stringify({
    lineId,
    description: body.originalDescription,
    interpretation,
    profile: hierarchical.profile.canonicalProduct,
    chapters: hierarchical.chapters.map((c) => c.chapter),
    retrievalTrace: hierarchical.retrievalTrace,
    candidatesRetrieved: candidates.map((entry) => entry.hs_code),
  }));

  const engineQuestion: ClassificationClarificationQuestion | null =
    hierarchical.criticalQuestion
      ? {
          id: hierarchical.criticalQuestion.id,
          prompt: hierarchical.criticalQuestion.prompt,
          options: hierarchical.criticalQuestion.options,
        }
      : clarificationFor(interpretation);

  if (!candidates.length) {
    const response = packResponse({
      status: "unable_to_classify",
      interpretation,
      recommendations: [],
      question: engineQuestion,
      warnings: [
        ...warnings,
        "Not enough retrieved tariff evidence to propose a code. Answer the clarification question or use manual search.",
      ],
    });
    await c.env.DB.prepare(
      `INSERT INTO classification_recommendations
        (line_id, status, product_profile_json, resolution_id, evidence_ids_json, generated_by)
       VALUES (?, 'unable_to_classify', ?, ?, ?, ?)`,
    )
      .bind(
        lineId,
        JSON.stringify({
          ...response.productProfile,
          classificationProfile: hierarchical.profile,
        }),
        body.resolutionId || null,
        JSON.stringify(body.evidenceIds || []),
        c.var.username,
      )
      .run();
    await c.env.DB.prepare(
      `UPDATE classification_lines
       SET classification_status = 'Needs Manual Review', product_profile_json = ?, updated_at = datetime('now') WHERE line_id = ?`,
    )
      .bind(JSON.stringify(profileFromEngine), lineId)
      .run();
    return c.json(response);
  }

  const provisional =
    hierarchical.recommendationStatus === "provisional"
    || hierarchical.recommendationStatus === "insufficient"
    || hierarchical.profile.missingCriticalAttributes.length > 0;

  let ranked = candidates;
  let selectedReason =
    scored[0]?.supportingFacts?.[0]
    || "Best retrieved tariff match for the product classification profile.";
  let selectedConfidence = candidates[0]?.score || 0.4;

  const supplierEvidencePayload: SupplierProductEvidence | null = supplierSearch.evidence
    ? {
        supplier: supplierSearch.evidence.supplier,
        supplierSku: supplierSearch.evidence.supplierSku,
        canonicalProduct: supplierSearch.evidence.canonicalProduct,
        material: supplierSearch.evidence.material,
        composition: supplierSearch.evidence.composition,
        capacity: supplierSearch.evidence.capacity,
        dimensions: supplierSearch.evidence.dimensions,
        technicalSpecifications: supplierSearch.evidence.technicalSpecifications,
        primaryFunction: supplierSearch.evidence.primaryFunction,
        intendedUse: supplierSearch.evidence.intendedUse,
        emptyOrFilled: supplierSearch.evidence.emptyOrFilled,
        sourceUrl: supplierSearch.evidence.sourceUrl,
        sourceType: supplierSearch.evidence.sourceType,
        retrievedAt: supplierSearch.evidence.retrievedAt,
        evidenceConfidence: supplierSearch.evidence.evidenceConfidence,
        excerpt: supplierSearch.evidence.excerpt,
      }
    : null;

  try {
    if (c.env.ANTHROPIC_API_KEY && !skipAiForExactInternal) {
      const en = await validateCandidatesWithExplanatoryNotes(
        c.env.DB,
        candidates.slice(0, 3),
        body.originalDescription,
        hierarchical.chapters[0]?.chapter || body.predictedChapter || null,
      );
      const supplierCtx = supplierSearch.aiContext
        ? `\nSupplier product evidence (structured, not a tariff code):\n${supplierSearch.aiContext.slice(0, 1500)}\n`
        : "";
      const prompt = `You are a Trinidad and Tobago customs tariff classification assistant.
You may ONLY choose from the supplied candidate codes retrieved from the official tariff database.
Never invent or recall a tariff code from memory.
If none fit, set selectedCode to null.
Empty packaging containers must be classified as the container (e.g. glass bottles under heading 7010), not as their intended food contents.
Do not use consignee industry (e.g. cocoa company) to override merchandise description.

CRITICAL: Reply with a single JSON object only. No prose, no markdown, no explanation outside JSON.
Required shape:
{"selectedCode":null,"confidence":0.0,"reason":"one short sentence","altReasons":{"CODE":"one short sentence"},"recommendationStatus":"provisional"}

Product Classification Profile:
${JSON.stringify(hierarchical.profile)}
${supplierCtx}
Original invoice description: ${body.originalDescription.slice(0, 180)}
Clarification answer: ${body.clarificationAnswer ? JSON.stringify(body.clarificationAnswer) : "none"}
Retrieved candidates (database only):
${JSON.stringify(candidates.map((candidate) => ({
  code: candidate.hs_code,
  description: candidate.title,
  score: candidate.score,
  dutyRate: candidate.duty_rate,
})))}
Scoring evidence:
${JSON.stringify(scored.slice(0, 5).map((c) => ({
  code: c.code,
  finalScore: c.finalScore,
  supportingFacts: c.supportingFacts,
  conflicts: c.conflicts,
})))}
Candidate-specific explanatory note evidence:
${JSON.stringify(en.excerptsForPrompt)}`;

      const text = await anthropicMessages(
        c.env.ANTHROPIC_API_KEY,
        [{ role: "user", content: prompt }],
        900,
      );
      const parsedRaw = extractJsonFromModelText(text);
      const parsed = (parsedRaw && typeof parsedRaw === "object" && !Array.isArray(parsedRaw)
        ? parsedRaw
        : null) as {
        selectedCode?: string | null;
        confidence?: number;
        reason?: string;
        altReasons?: Record<string, string>;
      } | null;

      if (!parsed) {
        warnings.push("AI returned non-JSON text; using retrieval ranking only.");
        console.warn("[classification] invalid_ai_json", {
          lineId,
          preview: String(text || "").slice(0, 120),
        });
      }

      const allowed = new Map(candidates.map((candidate) => [normalizedCode(candidate.hs_code), candidate]));
      const rawSelected = parsed?.selectedCode;
      let selected =
        rawSelected == null || String(rawSelected).trim() === "" || /^null$/i.test(String(rawSelected))
          ? null
          : allowed.get(normalizedCode(String(rawSelected))) || null;

      // Hard reject invented codes
      if (rawSelected && !selected) {
        warnings.push(`AI returned code ${rawSelected} that was not in retrieved candidates — rejected.`);
        console.warn("[classification] invalid_ai_code", { lineId, rawSelected });
        selected = null;
      }

      // If AI abstains or returns invalid JSON, keep retrieval ranking
      if (!selected) {
        selected = candidates[0];
        selectedReason = parsed?.reason
          || "Provisional retrieved match — confirm missing attributes before relying on this code.";
        selectedConfidence = Math.min(selected.score, 0.55);
      } else {
        selectedConfidence = Number.isFinite(parsed?.confidence)
          ? Number(parsed!.confidence)
          : selected.score;
        selectedReason = parsed?.reason || selectedReason;
      }

      ranked = [
        selected,
        ...candidates.filter((candidate) => normalizedCode(candidate.hs_code) !== normalizedCode(selected!.hs_code)),
      ];
      const altReasons = parsed?.altReasons || {};
      const recommendations = ranked.slice(0, 3).map((candidate, index) => {
        const scoredHit = scored.find((s) => normalizedCode(s.code) === normalizedCode(candidate.hs_code));
        const reason = index === 0
          ? selectedReason
          : altReasons[candidate.hs_code]
            || altReasons[normalizedCode(candidate.hs_code)]
            || scoredHit?.supportingFacts?.[0]
            || "Alternative retrieved tariff candidate.";
        return mapCandidate(
          candidate,
          reason,
          index === 0 ? selectedConfidence : candidate.score,
          provisional || selectedConfidence < 0.55 || !parsed,
        );
      });

      // Final safety: drop any code not in the tariff database
      const dbSafe = recommendations.filter((r) => Boolean(getNationalLine(r.code) || tariffByCode.get(normalizedCode(r.code))));
      if (!dbSafe.length) {
        throw new Error("No database-validated tariff candidates remained after AI ranking.");
      }

      const [verifiedRecommended, ...verifiedAlternatives] = await Promise.all([
        verifyCandidateWithTtbizlink(c.env.DB, dbSafe[0]),
        ...dbSafe.slice(1).map((candidate) => verifyCandidateWithTtbizlink(c.env.DB, candidate)),
      ]);
      const verified = [verifiedRecommended, ...verifiedAlternatives].filter(Boolean);
      const question = engineQuestion;
      const status: SimpleRecommendationStatus = question && provisional
        ? "clarification_needed"
        : provisional || selectedConfidence < 0.55
          ? "provisional"
          : "recommended";
      if (supplierSearch.notification) warnings.push(supplierSearch.notification);
      const response = packResponse({
        status,
        interpretation,
        recommendations: verified,
        question,
        warnings,
        supplierEvidence: supplierEvidencePayload,
        supplierSearchStatus: supplierSearch.status,
        supplierSearchNotification: supplierSearch.notification || null,
      });
      response.productProfile = {
        ...response.productProfile!,
        identifiedItem: hierarchical.profile.canonicalProduct,
        material: hierarchical.profile.material || response.productProfile!.material,
        productFamily: hierarchical.profile.productFamily || response.productProfile!.productFamily,
        primaryUse: hierarchical.profile.primaryFunction || response.productProfile!.primaryUse,
      };

      console.log("[classification]", JSON.stringify({
        lineId,
        finalRecommendations: verified.map((entry) => entry.code),
        status,
        question: question?.id || null,
        recommendationStatus: hierarchical.recommendationStatus,
        supplierSearch: supplierSearch.status,
      }));

      await c.env.DB.prepare(
        `INSERT INTO classification_recommendations
          (line_id, status, recommended_candidate_json, alternatives_json, product_profile_json,
           resolution_id, evidence_ids_json, generated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          lineId,
          status,
          JSON.stringify(verified[0] || null),
          JSON.stringify(verified.slice(1)),
          JSON.stringify({
            ...response.productProfile,
            classificationProfile: hierarchical.profile,
            chapters: hierarchical.chapters,
            retrievalTrace: hierarchical.retrievalTrace,
            supplierEvidence: supplierEvidencePayload,
          }),
          body.resolutionId || null,
          JSON.stringify(body.evidenceIds || []),
          c.var.username,
        )
        .run();
      await c.env.DB.prepare(
        `UPDATE classification_lines
         SET classification_status = ?, product_profile_json = ?, updated_at = datetime('now') WHERE line_id = ?`,
      )
        .bind(
          status === "clarification_needed" ? "More Information Needed" : "Suggestion Ready",
          JSON.stringify(profileFromEngine),
          lineId,
        )
        .run();
      await audit(c, "classification_recommendation_generated");
      return c.json(response);
    }

    // No Anthropic key, or exact internal SKU skip: retrieval-based suggestions.
    if (skipAiForExactInternal) {
      warnings.push("Resolved from approved supplier/SKU history — AI ranking skipped.");
    } else {
      warnings.push("AI ranking unavailable; showing retrieval-based provisional suggestions.");
    }
    const recommendations = ranked
      .slice(0, 3)
      .filter((candidate) => Boolean(getNationalLine(candidate.hs_code) || tariffByCode.get(normalizedCode(candidate.hs_code))))
      .map((candidate, index) =>
        mapCandidate(
          candidate,
          index === 0
            ? selectedReason
            : scored.find((s) => normalizedCode(s.code) === normalizedCode(candidate.hs_code))?.supportingFacts?.[0]
              || "Alternative retrieved tariff candidate.",
          candidate.score,
          !skipAiForExactInternal,
        ),
      );
    const verified = await Promise.all(
      recommendations.map((candidate) => verifyCandidateWithTtbizlink(c.env.DB, candidate)),
    );
    const question = skipAiForExactInternal ? null : engineQuestion;
    if (supplierSearch.notification) warnings.push(supplierSearch.notification);
    const response = packResponse({
      status: question && provisional ? "clarification_needed" : skipAiForExactInternal ? "recommended" : "provisional",
      interpretation,
      recommendations: verified,
      question,
      warnings,
      supplierEvidence: supplierEvidencePayload,
      supplierSearchStatus: supplierSearch.status,
      supplierSearchNotification: supplierSearch.notification || null,
    });
    response.productProfile = {
      ...response.productProfile!,
      identifiedItem: hierarchical.profile.canonicalProduct,
      material: hierarchical.profile.material || response.productProfile!.material,
      productFamily: hierarchical.profile.productFamily || response.productProfile!.productFamily,
      primaryUse: hierarchical.profile.primaryFunction || response.productProfile!.primaryUse,
    };
    await c.env.DB.prepare(
      `INSERT INTO classification_recommendations
        (line_id, status, recommended_candidate_json, alternatives_json, product_profile_json,
         resolution_id, evidence_ids_json, generated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        lineId,
        response.status,
        JSON.stringify(verified[0] || null),
        JSON.stringify(verified.slice(1)),
        JSON.stringify({
          ...response.productProfile,
          classificationProfile: hierarchical.profile,
          chapters: hierarchical.chapters,
          retrievalTrace: hierarchical.retrievalTrace,
        }),
        body.resolutionId || null,
        JSON.stringify(body.evidenceIds || []),
        c.var.username,
      )
      .run();
    await c.env.DB.prepare(
      `UPDATE classification_lines
       SET classification_status = ?, product_profile_json = ?, updated_at = datetime('now') WHERE line_id = ?`,
    )
      .bind(
        question && provisional ? "More Information Needed" : "Suggestion Ready",
        JSON.stringify(profileFromEngine),
        lineId,
      )
      .run();
    return c.json(response);
  } catch (error) {
    // On AI failure, prefer already-retrieved hierarchical candidates; never invent codes.
    const recovered = (ranked.length ? ranked : candidates)
      .slice(0, 3)
      .filter((candidate) => Boolean(getNationalLine(candidate.hs_code) || tariffByCode.get(normalizedCode(candidate.hs_code))))
      .map((candidate, index) =>
        mapCandidate(
          candidate,
          index === 0
            ? "Provisional retrieved match after AI ranking failed."
            : "Alternative provisional suggestion.",
          candidate.score,
          true,
        ),
      );
    if (recovered.length) {
      const verified = await Promise.all(
        recovered.map((candidate) => verifyCandidateWithTtbizlink(c.env.DB, candidate)),
      );
      const question = engineQuestion;
      const response = packResponse({
        status: question ? "clarification_needed" : "provisional",
        interpretation,
        recommendations: verified,
        question,
        warnings: [
          ...warnings,
          "AI ranking failed; showing retrieved provisional candidates.",
        ],
      });
      await c.env.DB.prepare(
        `UPDATE classification_lines
         SET classification_status = ?, product_profile_json = ?, updated_at = datetime('now') WHERE line_id = ?`,
      ).bind(
        question ? "More Information Needed" : "Suggestion Ready",
        JSON.stringify(profileFromEngine),
        lineId,
      ).run();
      return c.json(response);
    }
    const question = engineQuestion;
    const response = packResponse({
      status: "unable_to_classify",
      interpretation,
      recommendations: [],
      question,
      warnings: [
        ...warnings,
        "Classification ranking failed. No reliable tariff candidates found for this description.",
      ],
    });
    await c.env.DB.prepare(
      `UPDATE classification_lines
       SET classification_status = 'Needs Manual Review', updated_at = datetime('now') WHERE line_id = ?`,
    ).bind(lineId).run();
    return c.json(response);
  }
});

lines.post("/:lineId/apply-recommendation", async (c) => {
  const lineId = Number(c.req.param("lineId"));
  if (!Number.isFinite(lineId)) return c.json({ error: "Invalid line id" }, 400);
  const body = await c.req.json<{
    candidate?: ClassificationRecommendationCandidate;
    source?: "ai_recommendation" | "clerk_edited_ai_recommendation";
    resolutionId?: number;
    evidenceIds?: number[];
    productMasterId?: number | null;
  }>();
  if (!body.candidate?.code) return c.json({ error: "Candidate required" }, 400);

  const existing = await c.env.DB.prepare(`SELECT * FROM classification_lines WHERE line_id = ?`)
    .bind(lineId)
    .first<Record<string, unknown>>();
  if (!existing) {
    // Soft-create a minimal line so Apply still works without prior confirmation.
    await c.env.DB.prepare(
      `INSERT INTO classification_lines
        (line_id, invoice_id, original_description, classification_status, updated_by)
       VALUES (?, 'unsaved', ?, 'Suggestion Ready', ?)`,
    ).bind(lineId, body.candidate.description || body.candidate.code, c.var.username).run();
  }

  const lineRow = existing || await c.env.DB.prepare(`SELECT * FROM classification_lines WHERE line_id = ?`)
    .bind(lineId)
    .first<Record<string, unknown>>();
  if (!lineRow) return c.json({ error: "Classification line not found" }, 404);

  const source = body.source === "clerk_edited_ai_recommendation"
    ? body.source
    : "ai_recommendation";
  const status = source === "clerk_edited_ai_recommendation" ? "Applied" : "Applied";
  const candidate = await verifyCandidateWithTtbizlink(c.env.DB, body.candidate);
  // Prefer official verification, but do not block Apply when the local catalogue knows the code.
  const code = normalizedCode(candidate.code);
  const knownTariff = tariffByCode.get(code) || getNationalLine(candidate.code);
  if (
    candidate.officialVerification?.status === "not_found"
    && !knownTariff
    && !/^\d{4,10}(?:\.\d{1,4})*$/.test(candidate.code)
  ) {
    return c.json({ error: "Tariff code was not found in the official TTBizLink tariff finder" }, 409);
  }
  if (!knownTariff && !/^\d{4,10}(?:\.\d{1,4})*$/.test(candidate.code)) {
    return c.json({ error: "Invalid tariff code" }, 400);
  }

  const latestRecommendation = await c.env.DB.prepare(
    `SELECT id, resolution_id FROM classification_recommendations
     WHERE line_id = ? ORDER BY created_at DESC LIMIT 1`,
  )
    .bind(lineId)
    .first<{ id: number; resolution_id: number | null }>();

  // Duty/VAT must come from the tariff database for the selected code — never invent rates.
  const dbDuty = percent(knownTariff?.duty ?? candidate.dutyRate);
  const after = {
    tariff_code: knownTariff?.code || candidate.code,
    tariff_description: knownTariff?.desc || candidate.description || "",
    duty_rate: dbDuty,
    vat_rate: Number.isFinite(candidate.vatRate) ? candidate.vatRate : 12.5,
    levy_rate: Number.isFinite(candidate.levyRate) ? candidate.levyRate || 0 : 0,
    classification_status: status,
    recommendation_source: source,
    official_verification: candidate.officialVerification,
  };
  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE classification_lines SET
         tariff_code = ?,
         tariff_description = ?,
         duty_rate = ?,
         vat_rate = ?,
         levy_rate = ?,
         classification_status = ?,
         recommendation_source = ?,
         updated_by = ?,
         updated_at = datetime('now')
       WHERE line_id = ?`,
    ).bind(
      after.tariff_code,
      after.tariff_description,
      after.duty_rate,
      after.vat_rate,
      after.levy_rate,
      after.classification_status,
      after.recommendation_source,
      c.var.username,
      lineId,
    ),
    c.env.DB.prepare(
      `UPDATE classification_recommendations
       SET applied_at = datetime('now') WHERE id = ?`,
    ).bind(latestRecommendation?.id || null),
    c.env.DB.prepare(
      `INSERT INTO classification_line_events
        (line_id, recommendation_id, event_type, before_json, after_json, actor)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(
      lineId,
      latestRecommendation?.id || null,
      source === "clerk_edited_ai_recommendation" ? "edited_applied" : "recommendation_applied",
      JSON.stringify(lineRow),
      JSON.stringify(after),
      c.var.username,
    ),
    c.env.DB.prepare(
      `INSERT INTO classification_approvals
        (line_id, recommendation_id, resolution_id, product_master_id, selected_tariff,
         source, evidence_ids_json, approved_by, previous_value_json, approved_value_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      lineId,
      latestRecommendation?.id || null,
      body.resolutionId || null,
      body.productMasterId || null,
      after.tariff_code,
      source,
      JSON.stringify(body.evidenceIds || []),
      c.var.username,
      JSON.stringify(lineRow),
      JSON.stringify(after),
    ),
  ]);
  if (body.productMasterId) {
    await c.env.DB.prepare(
      `UPDATE product_master SET
         approved_tariffs_json = CASE
           WHEN EXISTS (
             SELECT 1 FROM json_each(product_master.approved_tariffs_json)
             WHERE replace(upper(value), ' ', '') = ?
           ) THEN approved_tariffs_json
           ELSE json_insert(approved_tariffs_json, '$[#]', ?)
         END,
         approval_count = approval_count + 1,
         last_approved_at = datetime('now'),
         updated_at = datetime('now')
       WHERE id = ?`,
    ).bind(code, after.tariff_code, body.productMasterId).run();
  }
  if (body.productMasterId && body.resolutionId) {
    const resolutionSupplier = await c.env.DB.prepare(
      `SELECT supplier_name FROM product_resolution_results WHERE id = ?`,
    ).bind(body.resolutionId).first<{ supplier_name: string | null }>();
    if (resolutionSupplier?.supplier_name) {
      await c.env.DB.prepare(
        `UPDATE supplier_products SET approved_tariff = ?, approval_count = approval_count + 1,
         last_approved_at = datetime('now'), updated_at = datetime('now')
         WHERE product_master_id = ? AND normalized_supplier = ?`,
      ).bind(
        after.tariff_code,
        body.productMasterId,
        resolutionSupplier.supplier_name.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim(),
      ).run();
    }
  }

  const updated = await c.env.DB.prepare(`SELECT * FROM classification_lines WHERE line_id = ?`)
    .bind(lineId)
    .first<Record<string, unknown>>();

  let totals = {
    goodsValue: 0,
    cifUSD: 0,
    cifTTD: 0,
    duty: 0,
    vat: 0,
    levy: 0,
    containerFee: 0,
    userFee: 0,
    totalTaxes: 0,
  };
  try {
    const invoiceId = String(lineRow.invoice_id || "unsaved");
    const invoiceLines = await c.env.DB.prepare(
      `SELECT line_id, original_description, tariff_code, quantity, unit_price,
              duty_rate, vat_rate, levy_rate
       FROM classification_lines WHERE invoice_id = ?`,
    )
      .bind(invoiceId)
      .all<Record<string, unknown>>();
    const worksheet = await c.env.DB.prepare(
      `SELECT tax_inputs_json, item_exemptions_json, exchange_rate
       FROM classification_worksheets WHERE invoice_id = ?`,
    )
      .bind(invoiceId)
      .first<Record<string, unknown>>();
    const defaultTaxInputs: TaxInputs = {
      freight: "",
      insurance: "",
      otherCharges: "",
      exchangeRate: "",
      containerSize: "none",
      userFee: false,
      vatExempt: false,
      combineAll: false,
    };
    let taxInputs = defaultTaxInputs;
    let itemExemptions: Record<number, ItemExemptions> = {};
    try {
      taxInputs = { ...defaultTaxInputs, ...JSON.parse(String(worksheet?.tax_inputs_json || "{}")) };
    } catch {
      taxInputs = defaultTaxInputs;
    }
    try {
      itemExemptions = JSON.parse(String(worksheet?.item_exemptions_json || "{}"));
    } catch {
      itemExemptions = {};
    }
    const summary = calculateTaxes(
      (invoiceLines.results || []).map((line) => ({
        id: Number(line.line_id),
        desc: String(line.original_description || ""),
        tariff_code: (line.tariff_code as string) || null,
        duty_rate: Number(line.duty_rate || 0) === 0 ? "Free" : `${Number(line.duty_rate)}%`,
        vat_rate: `${Number(line.vat_rate ?? 12.5)}%`,
        levy_rate: `${Number(line.levy_rate || 0)}%`,
        qty: Number(line.quantity || 0),
        price: Number(line.unit_price || 0),
      })),
      taxInputs,
      Number(worksheet?.exchange_rate || 6.75),
      itemExemptions,
    );
    totals = {
      goodsValue: summary.invoiceTotal,
      cifUSD: summary.cifUSD,
      cifTTD: summary.cifTTD,
      duty: summary.totalDuty,
      vat: summary.totalVAT,
      levy: summary.totalLevy,
      containerFee: summary.containerFee,
      userFee: summary.userFee,
      totalTaxes: summary.grandTotal,
    };
    await c.env.DB.prepare(
      `UPDATE classification_worksheets
       SET totals_json = ?, updated_by = ?, updated_at = datetime('now')
       WHERE invoice_id = ?`,
    )
      .bind(JSON.stringify(totals), c.var.username, invoiceId)
      .run();
  } catch (error) {
    // Line apply already committed — never fail the response on worksheet totals.
    console.warn("[classification] worksheet totals after apply failed", error);
  }

  await audit(c, source === "clerk_edited_ai_recommendation"
    ? "classification_recommendation_edited_applied"
    : "classification_recommendation_applied");
  const appliedCandidate: ClassificationRecommendationCandidate = {
    ...candidate,
    code: after.tariff_code,
    description: after.tariff_description,
    dutyRate: after.duty_rate,
    vatRate: after.vat_rate,
    levyRate: after.levy_rate,
  };
  return c.json({
    success: true,
    line: updated,
    candidate: appliedCandidate,
    worksheetTotals: totals,
  });
});

export default lines;
