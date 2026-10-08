import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { catFromCode, extractPartNumbers, getTariffRows } from "@pas/tariff-data";
import {
  groupInvoiceRows,
  detectInvoiceLineType,
  buildProductClassificationProfile,
  isNonMerchandiseLine,
} from "@pas/product-intelligence";
import type {
  Invoice,
  InvoiceCharge,
  LineItem,
  ParsedInvoice,
  ProductIntelligenceAnalyzeResult,
  ProductProfile,
  ProductQuestionAnswer,
  ProductResolverCandidate,
  SupplierClassificationEntry,
} from "@pas/shared-types";
import { api } from "@/lib/api-client";
import { recordClassificationBatch } from "@/lib/classification-metrics";
import { useInvoiceStore } from "@/stores/invoice-store";
import {
  chargeKindFromDescription,
  createChargeId,
  emptyInvoiceMetaExtras,
  isNonProductInvoiceLine,
  mergeChargesFromParsed,
  parseChargeAmount,
} from "@/lib/invoice-charges";
import { checkInvoiceTotals } from "@/lib/invoice-totals";
import type { DocumentProcessingJobStatus } from "@/lib/api-client";

const TT_TARIFF = getTariffRows();

function profileFromResolvedProduct(
  candidate: ProductResolverCandidate,
  item: LineItem,
  supplier: string,
): ProductProfile {
  const industry = (candidate.industry || "").toLowerCase();
  return {
    productName: candidate.canonicalName,
    normalizedName: candidate.canonicalName.toLowerCase(),
    industry: candidate.industry,
    industryCode: null,
    productFamily: candidate.productFamily,
    productType: candidate.canonicalName,
    material: candidate.typicalMaterials[0] || "Unknown",
    composition: null,
    primaryFunction: candidate.commonUses[0] || null,
    primaryUse: candidate.commonUses[0] || null,
    commercialUse: false,
    consumerUse: true,
    brand: null,
    model: item.model_number || null,
    partNumber: item.part_number || null,
    supplier: supplier || null,
    countryOfOrigin: null,
    gender: null,
    ageGroup: null,
    food: industry.includes("food"),
    chemical: industry.includes("chemical"),
    medical: industry.includes("medical"),
    electrical: industry.includes("electrical"),
    vehicle: industry.includes("vehicle") || industry.includes("automotive"),
    construction: industry.includes("construction"),
    textile: industry.includes("textile"),
    footwear: industry.includes("footwear"),
    machine: industry.includes("machine"),
    tool: industry.includes("tool"),
    hazardous: false,
    fragile: false,
    temperatureControlled: false,
    attributes: {},
  };
}

function applyPieResult(base: LineItem, pie: ProductIntelligenceAnalyzeResult): LineItem {
  const code = pie.suggested_hs_code ?? null;
  const identityBlocked = Boolean(pie.identity_unresolved);
  const skipAi = Boolean(pie.skip_ai && code) && !identityBlocked;
  const liquidBlocks = Boolean(pie.liquid_requires_review);
  const topHeadingScore = pie.predictions?.headings?.[0]?.score ?? 0;
  const noReliable =
    !identityBlocked &&
    !code &&
    (!(pie.predictions?.headings?.length) || topHeadingScore < 0.45) &&
    (pie.confidence ?? 0) < 0.45;

  return {
    ...base,
    product_profile: pie.profile,
    predictions: pie.predictions,
    pending_questions: pie.pending_questions,
    explainability: pie.explainability,
    attribute_confidences: pie.attribute_confidences ?? pie.explainability?.attributeConfidences,
    inferred_attributes: pie.inferred_attributes ?? pie.explainability?.inferredAttributes,
    liquid_profile: pie.liquid_profile ?? pie.explainability?.liquidProfile,
    liquid_confidences: pie.liquid_confidences ?? pie.explainability?.liquidConfidences,
    liquid_conflicts: pie.liquid_conflicts,
    liquid_requires_review: pie.liquid_requires_review,
    parsed_description: pie.parsed_description ?? pie.explainability?.parsedDescription,
    line_context: pie.line_context,
    identity_unresolved: identityBlocked,
    part_number: pie.parsed_description?.partNumber || base.part_number,
    model_number: pie.parsed_description?.sku || base.model_number,
    classification_path: pie.explainability
      ? [
          "line_parse",
          "product_profile",
          "attribute_library",
          ...(pie.liquid_profile ? ["liquid_composition"] : []),
          ...(identityBlocked ? ["identity_unresolved"] : ["chapter_prediction", "heading_prediction"]),
          ...(noReliable ? ["no_reliable_match"] : []),
          ...(skipAi && !liquidBlocks ? ["dictionary_resolve"] : identityBlocked || noReliable ? [] : ["ai_validation"]),
        ]
      : undefined,
    competing_headings: pie.predictions?.headings?.slice(1, 4).map((h) => h.hs_code),
    heading_considered: pie.predictions?.headings?.[0]?.heading,
    match_confidence: pie.confidence ?? pie.explainability?.confidence,
    ...(identityBlocked
      ? {
          tariff_code: null,
          duty_rate: "—",
          category: null,
          notes: "Product identity unresolved — confirm product type, material, and use before classifying",
          status: "needs_review" as const,
          source: "product_intelligence" as const,
          match_type: "Product Intelligence" as const,
          ai_skipped: true,
          requires_clerk_review: true,
        }
      : noReliable
        ? {
            tariff_code: null,
            duty_rate: "—",
            category: null,
            notes: "No reliable tariff suggestion was found.",
            status: "needs_review" as const,
            source: "product_intelligence" as const,
            match_type: "Product Intelligence" as const,
            ai_skipped: true,
            requires_clerk_review: true,
          }
      : skipAi && code && !liquidBlocks
        ? {
            tariff_code: code,
            duty_rate: pie.duty_rate ?? "—",
            category: catFromCode(code),
            notes: pie.explainability?.reasoningSummary?.slice(0, 180) || "Product Intelligence match",
            status: (pie.confidence ?? 0) >= 0.9 ? ("done" as const) : ("needs_review" as const),
            source: "product_intelligence" as const,
            match_type: "Product Intelligence" as const,
            ai_skipped: true,
            requires_clerk_review: (pie.confidence ?? 0) < 0.9 || (pie.pending_questions?.length ?? 0) > 0,
          }
        : {
            tariff_code: code,
            duty_rate: pie.duty_rate ?? "—",
            category: code ? catFromCode(code) : null,
            notes: liquidBlocks
              ? "Liquid composition incomplete — clerk review required"
              : "Pending AI validation among predicted headings",
            status: "needs_ai" as const,
            source: "ai" as const,
            match_type: "AI Suggested" as const,
            ai_skipped: false,
            requires_clerk_review: true,
          }),
  };
}

function invoiceLabel(fileName: string, parsed: ParsedInvoice, index: number, total: number) {
  if (total <= 1) return fileName;
  const tag = parsed.invoice_number || parsed.supplier || `Invoice ${index + 1}`;
  return `${fileName} · ${tag}`;
}

export function useInvoiceProcessor() {
  const setInvoices = useInvoiceStore((s) => s.setInvoices);
  const setActiveInvId = useInvoiceStore((s) => s.setActiveInvId);
  const supplierHistory = useInvoiceStore((s) => s.supplierHistory);
  const navigate = useNavigate();

  const processDocumentSource = useCallback(
    async (
      source: { kind: "file"; file: File } | { kind: "job"; jobId: string },
      onStep?: (step: number) => void,
      onProgress?: (msg: string) => void,
      onJob?: (job: DocumentProcessingJobStatus) => void,
    ) => {
      const baseId = Date.now();
      let sourceJobId: string | undefined = source.kind === "job" ? source.jobId : undefined;
      const onJobProgress = (job: DocumentProcessingJobStatus) => {
        sourceJobId = job.jobId;
        onJob?.(job);
        const stage = job.currentStage || job.status;
        if (job.pagesTotal > 0) {
          onProgress?.(
            `${stage} · ${job.pagesCompleted}/${job.pagesTotal} pages (${job.progressPercent}%)`,
          );
        } else {
          onProgress?.(stage);
        }
      };

      let parsedInvoices: ParsedInvoice[];
      let sourceName: string;
      if (source.kind === "file") {
        onStep?.(0);
        onProgress?.("Uploading document…");
        onStep?.(1);
        sourceName = source.file.name;
        const processed = await api.processDocument(source.file, onJobProgress);
        parsedInvoices = processed.invoices;
      } else {
        onStep?.(1);
        onProgress?.("Retrying from failed batch…");
        sourceName = "Document";
        await api.retryDocumentJob(source.jobId);
        ({ invoices: parsedInvoices } = await api.continueDocumentJob(source.jobId, onJobProgress));
        sourceJobId = source.jobId;
      }

      onStep?.(2);
      if (!parsedInvoices.length) throw new Error("No line items found in this file.");
      onProgress?.(
        `Found ${parsedInvoices.reduce((s, inv) => s + inv.items.length, 0)} line items — classifying…`,
      );

      const batchStats = {
        supplierHistoryHits: 0,
        learnedRuleHits: 0,
        manualReview: 0,
        totalLines: 0,
        aiClassified: 0,
        tokensSavedEstimate: 0,
      };

      const drafts: Array<{
        invId: number;
        parsed: ParsedInvoice;
        items: LineItem[];
        extraCharges: InvoiceCharge[];
        documentGoodsTotal: string;
        documentGrandTotal: string;
      }> = [];

      for (let index = 0; index < parsedInvoices.length; index++) {
        const parsed = parsedInvoices[index];
        const invId = baseId + index * 10_000;
        const supplierName = parsed.supplier || "";

        // Defense in depth: strip charge/fee rows; group continuation fragments
        const grouped = groupInvoiceRows(
          parsed.items.map((it) => ({
            description: it.description,
            qty: it.qty,
            unitPrice: it.unit_price,
            lineTotal: it.line_total,
            unit: it.unit,
          })),
        );
        const chargeLike = [
          ...parsed.items.filter((it) => isNonProductInvoiceLine(it.description)),
          ...grouped.charges.map((c) => ({
            description: c.description,
            qty: 1,
            unit: "EA",
            unit_price: c.amount,
            line_total: c.amount,
          })),
        ];
        const productParsedItems = grouped.merchandise.length
          ? grouped.merchandise.map((m) => ({
              description: m.cleanDescription || m.rawDescription,
              qty: m.quantity,
              unit: m.unit,
              unit_price: m.unitPrice,
              line_total: m.lineTotal,
              _extraction: m,
            }))
          : parsed.items
              .filter((it) => !isNonProductInvoiceLine(it.description))
              .map((it) => ({ ...it, _extraction: null as null }));
        // Only real CIF charges — never promote subtotal/total/payment rows into charges
        const extraCharges = chargeLike
          .filter((it) => {
            const typed = detectInvoiceLineType(it.description);
            return Boolean(typed.chargeKind) && parseChargeAmount(it.line_total) > 0;
          })
          .map((it) => ({
            id: createChargeId(),
            kind: chargeKindFromDescription(it.description),
            label: it.description.trim(),
            amount: String(parseChargeAmount(it.line_total)),
            includeInCif: true,
          }));

        // Recover document totals if the parser left them empty but rows carried amounts
        let documentGoodsTotal = parsed.goods_subtotal ? String(parsed.goods_subtotal) : "";
        let documentGrandTotal = parsed.invoice_total ? String(parsed.invoice_total) : "";
        if (!documentGoodsTotal || !documentGrandTotal) {
          for (const it of parsed.items) {
            const typed = detectInvoiceLineType(it.description);
            const amt = parseChargeAmount(it.line_total);
            if (amt <= 0) continue;
            if (!documentGoodsTotal && typed.lineType === "subtotal") documentGoodsTotal = String(amt);
            if (!documentGrandTotal && typed.lineType === "total") documentGrandTotal = String(amt);
          }
        }
        if (!documentGoodsTotal) {
          const lineSum = productParsedItems.reduce(
            (s, it) => s + parseChargeAmount(it.line_total || (it.qty || 1) * (it.unit_price || 0)),
            0,
          );
          if (lineSum > 0) documentGoodsTotal = String(Math.round(lineSum * 100) / 100);
        }
        if (!documentGrandTotal && documentGoodsTotal) {
          const chargeSum = [
            ...mergeChargesFromParsed(parsed.charges),
            ...extraCharges,
          ].reduce((s, c) => s + parseChargeAmount(c.amount), 0);
          documentGrandTotal = String(
            Math.round((parseChargeAmount(documentGoodsTotal) + chargeSum) * 100) / 100,
          );
        }

        const baseItems: LineItem[] = productParsedItems.map((it, i) => {
          const extraction = "_extraction" in it ? it._extraction : null;
          const desc = it.description;
          const { part_number, model_number } = extractPartNumbers(desc);
          const lineTotal = it.line_total > 0 ? it.line_total : (it.qty || 1) * (it.unit_price || 0);
          const qty = it.qty || 1;
          const lineType = detectInvoiceLineType(desc).lineType;
          const profilePreview = buildProductClassificationProfile(desc, null, { supplier: supplierName });
          const needsExtractionReview = Boolean(
            extraction && (extraction.groupingConfidence < 0.55 || extraction.groupingWarnings.length),
          );
          return {
            id: invId + i,
            desc,
            qty,
            unit: it.unit || "EA",
            price: qty > 0 ? lineTotal / qty : it.unit_price || 0,
            line_total: lineTotal,
            tariff_code: null,
            duty_rate: null,
            category: null,
            notes: needsExtractionReview
              ? "Product line may have been extracted incorrectly."
              : "Building product profile…",
            status: "loading" as const,
            source: "ai" as const,
            part_number: extraction?.supplierSku || part_number,
            model_number: extraction?.secondarySku || model_number,
            question_answers: [],
            line_type: lineType,
            extraction: {
              cleanDescription: extraction?.cleanDescription || profilePreview.cleanDescription || desc,
              supplierSku: extraction?.supplierSku || profilePreview.sku || part_number,
              secondarySku: extraction?.secondarySku || "",
              countryOfOrigin: extraction?.countryOfOrigin || "",
              specifications: (extraction?.specifications
                || profilePreview.technicalSpecifications
                || {}) as Record<string, string | number | boolean | null>,
              groupingConfidence: extraction?.groupingConfidence ?? 0.8,
              groupingWarnings: extraction?.groupingWarnings || [],
              needsExtractionReview,
            },
          };
        }).filter((item) => !isNonMerchandiseLine(item.desc));

        if (!baseItems.length) continue;

        batchStats.totalLines += baseItems.length;

        // Product identity is always resolved before Product Intelligence or AI classification.
        let resolverItems = baseItems;
        try {
          const resolved = await api.resolveProductsBatch({
            supplier: supplierName,
            items: baseItems.map((item) => ({
              lineId: item.id,
              description: item.desc,
              sku: item.part_number || item.model_number,
            })),
          });
          const byResolution = new Map(resolved.results.map((result) => [result.lineId, result.resolution]));
          resolverItems = baseItems.map((item) => {
            const resolution = byResolution.get(item.id);
            const candidate = resolution?.selected || resolution?.suggestions[0] || null;
            // A likely match may be preselected, but upload processing never confirms it.
            const confirmed = false;
            return {
              ...item,
              product_resolution: resolution,
              canonical_product_id: candidate?.canonicalProductId,
              product_confirmed: confirmed,
              identity_unresolved: !confirmed,
              product_profile: candidate
                ? profileFromResolvedProduct(candidate, item, supplierName)
                : undefined,
              match_confidence: resolution?.confidence || 0,
              status: "needs_review" as const,
              classification_status: candidate ? "Suggestion Ready" as const : "Generating Suggestions" as const,
              source: "product_intelligence" as const,
              ai_skipped: !confirmed,
              requires_clerk_review: !confirmed,
              classification_path: resolution?.resolverPath,
              notes: candidate
                ? `Likely product: ${candidate.canonicalName}. Clerk confirmation required.`
                : "Product unresolved. Review evidence before tariff classification.",
            };
          });
        } catch {
          resolverItems = baseItems.map((item) => ({
            ...item,
            status: "needs_review" as const,
            classification_status: "Generating Suggestions" as const,
            source: "manual" as const,
            identity_unresolved: true,
            product_confirmed: false,
            ai_skipped: true,
            requires_clerk_review: true,
            notes: "Product Resolver unavailable — identify the product manually.",
          }));
        }

        let pieResults: ProductIntelligenceAnalyzeResult[] = [];
        const resolvableItems = resolverItems.filter((item) => item.product_confirmed);
        try {
          const analyzePayload = resolvableItems.map((it) => ({
            line_id: it.id,
            description: it.desc,
            part_number: it.part_number,
            model_number: it.model_number,
            answers: it.product_resolution?.selected
              ? [{
                  question_id: "product_resolver_confirmed",
                  field: "product_type",
                  value: it.product_resolution.selected.canonicalName,
                }]
              : undefined,
          }));
          // Chunk to avoid Cloudflare 524 timeouts on large invoices
          const CHUNK = 20;
          for (let i = 0; i < analyzePayload.length; i += CHUNK) {
            const analyzed = await api.analyzeProductIntelligence({
              supplier_name: supplierName,
              supplier_history: supplierHistory as unknown as SupplierClassificationEntry[],
              items: analyzePayload.slice(i, i + CHUNK),
            });
            pieResults = pieResults.concat(analyzed.results);
          }
        } catch {
          pieResults = [];
        }

        const byPie = new Map(pieResults.map((r) => [r.line_id, r]));
        let items = resolverItems.map((it) => {
          if (!it.product_confirmed) {
            batchStats.manualReview++;
            return it;
          }
          const pie = byPie.get(it.id);
          if (!pie) {
            return {
              ...it,
              notes: "Product Intelligence unavailable — manual review",
              status: "error" as const,
              source: "manual" as const,
              match_type: "Manual Classification" as const,
            };
          }
          const applied = {
            ...applyPieResult(it, pie),
            product_resolution: it.product_resolution,
            canonical_product_id: it.canonical_product_id,
            product_confirmed: true,
            identity_unresolved: false,
            tariff_code: null,
            duty_rate: null,
            category: null,
            status: "needs_review" as const,
            source: "product_intelligence" as const,
            classification_status: "Generating Suggestions" as const,
            notes: "Generating tariff suggestions…",
            requires_clerk_review: true,
          };
          if (applied.ai_skipped) batchStats.supplierHistoryHits++;
          if (applied.requires_clerk_review) batchStats.manualReview++;
          return applied;
        });

        // Recommendations are generated by the explicit line workflow after product detection.
        // Do not apply or validate a tariff code during upload.
        const needsAI: LineItem[] = [];

        if (needsAI.length) {
          onStep?.(3);
          try {
            const batch = await api.classifyBatch({
              supplier_name: supplierName,
              items: needsAI.map((it) => ({
                line_id: it.id,
                description: it.desc,
                part_number: it.part_number,
                model_number: it.model_number,
                product_profile: it.product_profile,
                chapter_prediction: it.predictions?.chapter ?? null,
                heading_candidates: it.predictions?.headings ?? [],
                brand: it.product_profile?.brand,
                industry: it.product_profile?.industry,
                product_family: it.product_profile?.productFamily,
                liquid_profile: it.liquid_profile,
                liquid_confidences: it.liquid_confidences,
              })),
            });

            const byId = new Map(batch.results.map((r) => [r.line_id, r]));
            items = items.map((it) => {
              const r = byId.get(it.id);
              if (!r) return it;
              const code = r.selected_hs_code || r.suggested_hs_code;
              return {
                ...it,
                tariff_code: code,
                duty_rate: "—",
                category: catFromCode(code),
                notes: r.reason_short,
                status: r.needs_review || r.requires_review ? ("needs_review" as const) : ("done" as const),
                source: "ai" as const,
                match_type: "AI Suggested" as const,
                match_confidence: r.confidence,
                competing_headings: r.competing_headings,
                requires_clerk_review: r.needs_review || r.requires_review,
                ai_skipped: false,
                classification_path: [
                  "product_profile",
                  "chapter_prediction",
                  "heading_prediction",
                  "ai_validation",
                ],
                explainability: it.explainability
                  ? {
                      ...it.explainability,
                      knowledgeSources: [
                        ...new Set([...(it.explainability.knowledgeSources ?? []), "AI Validation"]),
                      ],
                      reasoningSummary: `${it.explainability.reasoningSummary} AI selected ${code}: ${r.reason_short}`,
                      confidence: r.confidence,
                    }
                  : it.explainability,
              };
            });
            batchStats.aiClassified += needsAI.filter((it) => byId.has(it.id)).length;
            batchStats.tokensSavedEstimate =
              (batch.tokens_saved_estimate ?? 0) + (batchStats.totalLines - needsAI.length) * 200;
          } catch {
            items = items.map((it) =>
              it.status === "needs_ai"
                ? {
                    ...it,
                    tariff_code: it.predictions?.predictedHsCode || it.tariff_code || "⚠ Check manually",
                    duty_rate: it.duty_rate || "—",
                    status: "needs_review" as const,
                    notes: "AI validation failed — use predicted heading or pick manually",
                    requires_clerk_review: true,
                  }
                : it,
            );
          }
        } else {
          batchStats.tokensSavedEstimate = batchStats.totalLines * 200;
        }

        drafts.push({ invId, parsed, items, extraCharges, documentGoodsTotal, documentGrandTotal });
      }

      recordClassificationBatch(batchStats);

      onStep?.(4);
      const newInvoices: Invoice[] = drafts.map(
        ({ invId, parsed, items, extraCharges, documentGoodsTotal, documentGrandTotal }, index) => ({
        id: invId,
        filename: invoiceLabel(sourceName, parsed, index, drafts.length),
        meta: {
          number: parsed.invoice_number || "",
          date: parsed.invoice_date || "",
          supplier: parsed.supplier || "",
          from: parsed.ship_from || "",
          to: parsed.ship_to || "",
          clerk: "",
          currency: "USD",
          currencyRateToTTD: "",
          ...emptyInvoiceMetaExtras(),
          documentGoodsTotal,
          documentGrandTotal,
          charges: [...mergeChargesFromParsed(parsed.charges), ...extraCharges],
          sourceJobId,
        },
        items,
        status: "done" as const,
      }),
      );

      newInvoices.forEach((inv) => {
        const check = checkInvoiceTotals(inv);
        inv.meta.totalsMismatch = check.mismatch;
      });

      setInvoices((prev) => [...prev, ...newInvoices]);
      setActiveInvId(newInvoices[0].id);
      navigate("/review");
    },
    [navigate, setActiveInvId, setInvoices, supplierHistory],
  );

  const processFile = useCallback(
    async (
      file: File,
      onStep?: (step: number) => void,
      onProgress?: (msg: string) => void,
      onJob?: (job: DocumentProcessingJobStatus) => void,
    ) => processDocumentSource({ kind: "file", file }, onStep, onProgress, onJob),
    [processDocumentSource],
  );

  const resumeJob = useCallback(
    async (
      jobId: string,
      onStep?: (step: number) => void,
      onProgress?: (msg: string) => void,
      onJob?: (job: DocumentProcessingJobStatus) => void,
    ) => processDocumentSource({ kind: "job", jobId }, onStep, onProgress, onJob),
    [processDocumentSource],
  );

  const reanalyzeLine = useCallback(
    async (
      invId: number,
      item: LineItem,
      answers: ProductQuestionAnswer[],
      supplierName?: string,
    ) => {
      setInvoices((prev) =>
        prev.map((inv) =>
          inv.id === invId
            ? {
                ...inv,
                items: inv.items.map((it) =>
                  it.id === item.id ? { ...it, status: "loading" as const, question_answers: answers } : it,
                ),
              }
            : inv,
        ),
      );

      try {
        const { result } = await api.reanalyzeProductIntelligence({
          supplier_name: supplierName,
          supplier_history: useInvoiceStore.getState().supplierHistory as unknown as SupplierClassificationEntry[],
          line_id: item.id,
          description: item.desc,
          part_number: item.part_number,
          model_number: item.model_number,
          answers,
        });

        let next = applyPieResult({ ...item, question_answers: answers }, result);

        if (!next.ai_skipped && (next.predictions?.headings?.length ?? 0) > 0 && next.product_profile) {
          try {
            const batch = await api.classifyBatch({
              supplier_name: supplierName || "",
              items: [
                {
                  line_id: next.id,
                  description: next.desc,
                  part_number: next.part_number,
                  model_number: next.model_number,
                  product_profile: next.product_profile,
                  chapter_prediction: next.predictions?.chapter ?? null,
                  heading_candidates: next.predictions?.headings ?? [],
                  brand: next.product_profile.brand,
                  industry: next.product_profile.industry,
                  product_family: next.product_profile.productFamily,
                  liquid_profile: next.liquid_profile,
                  liquid_confidences: next.liquid_confidences,
                },
              ],
            });
            const r = batch.results[0];
            if (r) {
              const code = r.selected_hs_code || r.suggested_hs_code;
              next = {
                ...next,
                tariff_code: code,
                duty_rate: "—",
                category: catFromCode(code),
                notes: r.reason_short,
                status: r.needs_review || r.requires_review ? "needs_review" : "done",
                source: "ai",
                match_type: "AI Suggested",
                match_confidence: r.confidence,
                competing_headings: r.competing_headings,
                requires_clerk_review: r.needs_review || r.requires_review,
                ai_skipped: false,
                classification_path: [
                  "product_profile",
                  "chapter_prediction",
                  "heading_prediction",
                  "questions",
                  "ai_validation",
                ],
              };
            }
          } catch {
            next = { ...next, status: "needs_review", requires_clerk_review: true };
          }
        }

        setInvoices((prev) =>
          prev.map((inv) =>
            inv.id === invId
              ? { ...inv, items: inv.items.map((it) => (it.id === item.id ? next : it)) }
              : inv,
          ),
        );
      } catch {
        setInvoices((prev) =>
          prev.map((inv) =>
            inv.id === invId
              ? {
                  ...inv,
                  items: inv.items.map((it) =>
                    it.id === item.id ? { ...it, status: "error" as const } : it,
                  ),
                }
              : inv,
          ),
        );
      }
    },
    [setInvoices],
  );

  const saveLearnedPair = async (desc: string, code: string, duty: string, category: string) => {
    await api.saveLearned({ desc, tariff_code: code, duty_rate: duty, category });
  };

  const saveToSupplierHistory = async (
    supplierName: string,
    item: LineItem,
    sourceJobId?: string,
  ) => {
    if (!supplierName.trim() || !item.tariff_code || !item.desc) return;
    await api.saveSupplierHistory({
      supplier_name: supplierName,
      item_description: item.desc,
      hs_code: item.tariff_code,
      duty_rate: item.duty_rate || "Free",
      tariff_description: item.category || undefined,
      part_number: item.part_number,
      model_number: item.model_number,
      brand: item.product_profile?.brand || undefined,
      match_type: item.match_type === "Supplier Fuzzy" ? "supplier_fuzzy" : "supplier_exact",
      source_job_id: sourceJobId,
      confidence: item.match_confidence ?? 1,
    });
    const { entries } = await api.getSupplierHistory({ limit: 2000 });
    useInvoiceStore.getState().setSupplierHistory(entries);
  };

  const persistProductLearning = async (
    item: LineItem,
    hsCode: string,
    supplierName?: string,
    invoiceId?: string,
  ) => {
    if (!item.product_profile) return;
    try {
      const res = await api.learnProductIntelligence({
        original_description: item.desc,
        profile: item.product_profile,
        predictions: item.predictions,
        questions: item.pending_questions,
        answers: item.question_answers,
        explainability: item.explainability,
        selected_hs_code: hsCode,
        duty_rate: item.duty_rate || undefined,
        supplier_name: supplierName,
        brand: item.product_profile.brand || undefined,
        invoice_id: invoiceId,
        liquid_profile: item.liquid_profile,
      });
      return res.profile_id;
    } catch {
      return undefined;
    }
  };

  const confirmAndLearn = useCallback(
    async (invId: number, item: LineItem, newCode: string, supplierName?: string) => {
      const code = newCode.trim();
      if (!code) return;
      const entry = TT_TARIFF.find((row) => row.code === code);
      if (entry) {
        setInvoices((prev) =>
          prev.map((inv) =>
            inv.id === invId
              ? {
                  ...inv,
                  items: inv.items.map((it) =>
                    it.id === item.id
                      ? {
                          ...it,
                          tariff_code: entry.code,
                          duty_rate: entry.duty,
                          category: catFromCode(entry.code),
                          source: "manual",
                          match_type: "Manual Classification",
                          notes: `Manually entered · Official T&T Customs tariff · ${entry.desc}`,
                          status: "done",
                        }
                      : it,
                  ),
                }
              : inv,
          ),
        );
        await saveLearnedPair(item.desc, entry.code, entry.duty, catFromCode(entry.code));
        if (supplierName) {
          await saveToSupplierHistory(
            supplierName,
            { ...item, tariff_code: entry.code, duty_rate: entry.duty },
            String(invId),
          );
        }
        await persistProductLearning(item, entry.code, supplierName, String(invId));
      } else if (/^\d{4}\.\d{2}\.\d{2}$/.test(code)) {
        setInvoices((prev) =>
          prev.map((inv) =>
            inv.id === invId
              ? {
                  ...inv,
                  items: inv.items.map((it) =>
                    it.id === item.id
                      ? {
                          ...it,
                          tariff_code: code,
                          notes: "⚠ Code not in local DB — verify at ttbizlink.gov.tt",
                          source: "manual",
                          match_type: "Manual Classification",
                          status: "done",
                        }
                      : it,
                  ),
                }
              : inv,
          ),
        );
        if (supplierName) {
          await saveToSupplierHistory(supplierName, { ...item, tariff_code: code }, String(invId));
        }
        await persistProductLearning(item, code, supplierName, String(invId));
      }
    },
    [setInvoices],
  );

  return {
    processFile,
    resumeJob,
    confirmAndLearn,
    saveLearnedPair,
    saveToSupplierHistory,
    reanalyzeLine,
    persistProductLearning,
  };
}
