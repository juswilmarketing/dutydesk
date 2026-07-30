import { Hono } from "hono";
import { getTariffRows, searchTariff, similarCodes } from "@pas/tariff-data";
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
import { calculateTaxes } from "@pas/tax-engine";
import type { Env, AppVariables } from "../env";
import { anthropicMessages } from "../lib/anthropic";
import { validateCandidatesWithExplanatoryNotes } from "../lib/en-validate";
import { audit } from "../lib/utils";
import { verifyCandidateWithTtbizlink } from "../lib/ttbizlink";

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
}): ClassificationRecommendationResponse {
  const recommendations = input.recommendations.slice(0, 3);
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
  }>();
  if (!body.originalDescription?.trim()) {
    return c.json({ error: "Original description is required" }, 400);
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

  const interpretation = buildInterpretation(profile, body.originalDescription);
  const warnings: string[] = [];
  let candidates = qualityCandidates((body.headingCandidates || []).slice(0, 5));
  if (!candidates.length) {
    candidates = fallbackHeadingCandidates(body.originalDescription, body.predictedChapter);
    if (candidates.length) {
      warnings.push("Using tariff catalogue search because product intelligence returned no reliable headings.");
    }
  }

  console.log("[classification]", JSON.stringify({
    lineId,
    description: body.originalDescription,
    interpretation,
    predictedChapter: body.predictedChapter || null,
    candidatesRetrieved: candidates.map((entry) => entry.hs_code),
  }));

  if (!candidates.length) {
    const question = clarificationFor(interpretation);
    const response = packResponse({
      status: "unable_to_classify",
      interpretation,
      recommendations: [],
      question,
      warnings: ["Not enough context to propose a tariff code. Use manual search or answer the clarification question."],
    });
    await c.env.DB.prepare(
      `INSERT INTO classification_recommendations
        (line_id, status, product_profile_json, resolution_id, evidence_ids_json, generated_by)
       VALUES (?, 'unable_to_classify', ?, ?, ?, ?)`,
    )
      .bind(
        lineId,
        JSON.stringify(response.productProfile),
        body.resolutionId || null,
        JSON.stringify(body.evidenceIds || []),
        c.var.username,
      )
      .run();
    await c.env.DB.prepare(
      `UPDATE classification_lines
       SET classification_status = 'Needs Manual Review', updated_at = datetime('now') WHERE line_id = ?`,
    )
      .bind(lineId)
      .run();
    return c.json(response);
  }

  // Clarification answers that resolve material/function should not force provisional
  const clarificationResolved =
    Boolean(body.clarificationAnswer?.value) &&
    !/^unknown$/i.test(String(body.clarificationAnswer?.value || ""));
  const provisional = (!body.productProfile?.material
    || /^unknown$/i.test(String(body.productProfile.material || ""))
    || !body.headingCandidates?.length)
    && !clarificationResolved;

  try {
    let ranked = candidates;
    let selectedReason = "Best available match for the invoice description and product interpretation.";
    let selectedConfidence = candidates[0]?.score || 0.4;
    let aiRejectedAll = false;

    if (c.env.ANTHROPIC_API_KEY) {
      const en = await validateCandidatesWithExplanatoryNotes(
        c.env.DB,
        candidates.slice(0, 3),
        body.originalDescription,
        body.predictedChapter || null,
      );
      const prompt = `You are a Trinidad and Tobago customs tariff classification assistant.
Choose the best code from the supplied candidates ONLY if one actually describes the product.
If NONE of the candidates fit the product, set selectedCode to null.
Do not invent a tariff code.
Return compact JSON only:
{"selectedCode":null,"confidence":0.0,"reason":"one short sentence","altReasons":{"CODE":"one short sentence"}}

Product interpretation:
${JSON.stringify(interpretation)}

Original invoice description: ${body.originalDescription.slice(0, 180)}
Predicted chapter: ${body.predictedChapter || "Unknown"}
Clarification answer: ${body.clarificationAnswer ? JSON.stringify(body.clarificationAnswer) : "none"}
Candidates:
${JSON.stringify(candidates.map((candidate) => ({
  code: candidate.hs_code,
  description: candidate.title,
  score: candidate.score,
  dutyRate: candidate.duty_rate,
})))}
Candidate-specific explanatory note evidence:
${JSON.stringify(en.excerptsForPrompt)}`;

      const text = await anthropicMessages(
        c.env.ANTHROPIC_API_KEY,
        [{ role: "user", content: prompt }],
        700,
      );
      const parsed = JSON.parse(text.replace(/```json|```/g, "").trim()) as {
        selectedCode?: string | null;
        confidence?: number;
        reason?: string;
        altReasons?: Record<string, string>;
      };
      const allowed = new Map(candidates.map((candidate) => [normalizedCode(candidate.hs_code), candidate]));
      const rawSelected = parsed.selectedCode;
      const selected =
        rawSelected == null || String(rawSelected).trim() === "" || /^null$/i.test(String(rawSelected))
          ? null
          : allowed.get(normalizedCode(String(rawSelected))) || null;

      if (!selected) {
        aiRejectedAll = true;
        selectedReason = parsed.reason || "None of the retrieved tariff candidates match this product.";
        const question = clarificationFor(interpretation);
        const response = packResponse({
          status: "unable_to_classify",
          interpretation,
          recommendations: [],
          question,
          warnings: [
            ...warnings,
            selectedReason,
          ],
        });
        await c.env.DB.prepare(
          `INSERT INTO classification_recommendations
            (line_id, status, product_profile_json, resolution_id, evidence_ids_json, generated_by)
           VALUES (?, 'unable_to_classify', ?, ?, ?, ?)`,
        )
          .bind(
            lineId,
            JSON.stringify(response.productProfile),
            body.resolutionId || null,
            JSON.stringify(body.evidenceIds || []),
            c.var.username,
          )
          .run();
        await c.env.DB.prepare(
          `UPDATE classification_lines
           SET classification_status = 'Needs Manual Review', updated_at = datetime('now') WHERE line_id = ?`,
        )
          .bind(lineId)
          .run();
        await audit(c, "classification_recommendation_generated");
        return c.json(response);
      }

      selectedConfidence = Number.isFinite(parsed.confidence)
        ? Number(parsed.confidence)
        : selected.score;
      selectedReason = parsed.reason || selectedReason;
      ranked = [
        selected,
        ...candidates.filter((candidate) => normalizedCode(candidate.hs_code) !== normalizedCode(selected.hs_code)),
      ];
      const altReasons = parsed.altReasons || {};
      const recommendations = ranked.slice(0, 3).map((candidate, index) =>
        mapCandidate(
          candidate,
          index === 0
            ? selectedReason
            : altReasons[candidate.hs_code]
              || altReasons[normalizedCode(candidate.hs_code)]
              || "Alternative candidate for the same product interpretation.",
          index === 0 ? selectedConfidence : candidate.score,
          provisional || selectedConfidence < 0.55,
        ),
      );

      const [verifiedRecommended, ...verifiedAlternatives] = await Promise.all([
        verifyCandidateWithTtbizlink(c.env.DB, recommendations[0]),
        ...recommendations.slice(1).map((candidate) => verifyCandidateWithTtbizlink(c.env.DB, candidate)),
      ]);
      const verified = [verifiedRecommended, ...verifiedAlternatives].filter(Boolean);
      const question = clarificationFor(interpretation);
      const status: SimpleRecommendationStatus = question && provisional
        ? "clarification_needed"
        : provisional || selectedConfidence < 0.55
          ? "provisional"
          : "recommended";
      const response = packResponse({
        status,
        interpretation,
        recommendations: verified,
        question,
        warnings,
      });

      console.log("[classification]", JSON.stringify({
        lineId,
        finalRecommendations: verified.map((entry) => entry.code),
        status,
        question: question?.id || null,
        aiRejectedAll,
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
          JSON.stringify(response.productProfile),
          body.resolutionId || null,
          JSON.stringify(body.evidenceIds || []),
          c.var.username,
        )
        .run();
      await c.env.DB.prepare(
        `UPDATE classification_lines
         SET classification_status = ?, updated_at = datetime('now') WHERE line_id = ?`,
      )
        .bind(status === "clarification_needed" ? "More Information Needed" : "Suggestion Ready", lineId)
        .run();
      await audit(c, "classification_recommendation_generated");
      return c.json(response);
    }

    // No Anthropic key: still return catalogue-based provisional suggestions.
    warnings.push("AI ranking unavailable; showing catalogue-based provisional suggestions.");
    const recommendations = ranked.slice(0, 3).map((candidate, index) =>
      mapCandidate(
        candidate,
        index === 0
          ? "Provisional catalogue match based on product interpretation."
          : "Alternative catalogue match for the same description.",
        candidate.score,
        true,
      ),
    );
    const verified = await Promise.all(
      recommendations.map((candidate) => verifyCandidateWithTtbizlink(c.env.DB, candidate)),
    );
    const question = clarificationFor(interpretation);
    const response = packResponse({
      status: question ? "clarification_needed" : "provisional",
      interpretation,
      recommendations: verified,
      question,
      warnings,
    });
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
        JSON.stringify(response.productProfile),
        body.resolutionId || null,
        JSON.stringify(body.evidenceIds || []),
        c.var.username,
      )
      .run();
    await c.env.DB.prepare(
      `UPDATE classification_lines
       SET classification_status = ?, updated_at = datetime('now') WHERE line_id = ?`,
    )
      .bind(question ? "More Information Needed" : "Suggestion Ready", lineId)
      .run();
    return c.json(response);
  } catch (error) {
    // On AI failure, only return catalogue fallback when lexical quality is sufficient
    const fallback = fallbackHeadingCandidates(body.originalDescription, body.predictedChapter)
      .slice(0, 3)
      .map((candidate, index) =>
        mapCandidate(
          candidate,
          index === 0
            ? "Provisional suggestion after AI ranking failed."
            : "Alternative provisional suggestion.",
          candidate.score,
          true,
        ),
      );
    if (fallback.length) {
      const verified = await Promise.all(
        fallback.map((candidate) => verifyCandidateWithTtbizlink(c.env.DB, candidate)),
      );
      const question = clarificationFor(interpretation);
      const response = packResponse({
        status: "provisional",
        interpretation,
        recommendations: verified,
        question,
        warnings: [
          ...warnings,
          error instanceof Error ? error.message : "Classification ranking failed",
        ],
      });
      await c.env.DB.prepare(
        `UPDATE classification_lines
         SET classification_status = 'Suggestion Ready', updated_at = datetime('now') WHERE line_id = ?`,
      ).bind(lineId).run();
      return c.json(response);
    }
    const question = clarificationFor(interpretation);
    const response = packResponse({
      status: "unable_to_classify",
      interpretation,
      recommendations: [],
      question,
      warnings: [
        ...warnings,
        error instanceof Error ? error.message : "Classification ranking failed",
        "No reliable tariff candidates found for this description.",
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
  const knownTariff = tariffByCode.get(code);
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
  const after = {
    tariff_code: knownTariff?.code || candidate.code,
    tariff_description: candidate.description || knownTariff?.desc || "",
    duty_rate: candidate.dutyRate,
    vat_rate: candidate.vatRate,
    levy_rate: candidate.levyRate || 0,
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
  const totals = {
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

  await audit(c, source === "clerk_edited_ai_recommendation"
    ? "classification_recommendation_edited_applied"
    : "classification_recommendation_applied");
  return c.json({ success: true, line: updated, candidate, worksheetTotals: totals });
});

export default lines;
