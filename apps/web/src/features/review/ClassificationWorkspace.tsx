import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ClassificationRecommendationCandidate,
  EvidenceProductResolution,
  LineItem,
  LiquidProductProfile,
  ProductQuestionAnswer,
  ProductResolution,
  ProductResolverCandidate,
} from "@pas/shared-types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { LineQueuePanel } from "./LineQueuePanel";
import { ClassificationCentre } from "./ClassificationCentre";
import { AiAssistantPanel } from "./AiAssistantPanel";
import { ProductResolverPanel } from "./ProductResolverPanel";
import { api } from "@/lib/api-client";
import { useInvoiceStore } from "@/stores/invoice-store";
import { useWorkflowStore } from "@/stores/workflow-store";

type Props = {
  items: LineItem[];
  invId: number;
  supplierName?: string;
  shipmentId?: string;
  updatingLine: number | null;
  selectedIds: number[];
  setSelectedIds: (ids: number[]) => void;
  setItemReview: React.Dispatch<React.SetStateAction<Record<number, "approved" | "flagged">>>;
  editItem: (
    invId: number,
    itemId: number,
    field: keyof LineItem,
    value: LineItem[keyof LineItem],
  ) => void;
  setLineAnswers: (invId: number, itemId: number, answers: ProductQuestionAnswer[]) => void;
  setLiquidProfile: (invId: number, itemId: number, profile: LiquidProductProfile) => void;
  setProductResolution: (
    invId: number,
    itemId: number,
    resolution: ProductResolution,
    candidate: ProductResolverCandidate,
    confirmed: boolean,
  ) => void;
  reanalyzeLine: (
    invId: number,
    item: LineItem,
    answers: ProductQuestionAnswer[],
    supplierName?: string,
  ) => Promise<void>;
  saveLearnedPair: (desc: string, code: string, duty: string, category: string) => Promise<void>;
  persistProductLearning: (
    item: LineItem,
    code: string,
    supplierName?: string,
    invoiceId?: string,
  ) => Promise<number | void | undefined>;
  onNavigateSupplierHistory: () => void;
  onNavigateTariffSearch: () => void;
  setUpdatingLine: (id: number | null) => void;
};

function preferredCandidate(item: LineItem): ClassificationRecommendationCandidate | null {
  const response = item.classification_recommendation;
  if (!response) return null;
  return response.recommendations?.[0] || response.recommendedCandidate || null;
}

function mapLineStatus(responseStatus: string | undefined): LineItem["classification_status"] {
  if (responseStatus === "clarification_needed") return "More Information Needed";
  if (responseStatus === "unable_to_classify") return "Needs Manual Review";
  if (responseStatus === "recommended" || responseStatus === "provisional" || responseStatus === "recommendation_ready") {
    return "Suggestion Ready";
  }
  if (responseStatus === "no_reliable_match") return "Needs Manual Review";
  return "Suggestion Ready";
}

export function ClassificationWorkspace({
  items,
  invId,
  supplierName,
  shipmentId,
  updatingLine,
  selectedIds,
  setSelectedIds,
  setItemReview,
  editItem,
  setLineAnswers,
  setLiquidProfile: _setLiquidProfile,
  setProductResolution,
  reanalyzeLine,
  saveLearnedPair,
  persistProductLearning,
  onNavigateSupplierHistory,
  onNavigateTariffSearch,
  setUpdatingLine,
}: Props) {
  const [activeId, setActiveId] = useState<number | null>(items[0]?.id ?? null);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [mobileLineOpen, setMobileLineOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [recommendationErrors, setRecommendationErrors] = useState<Record<number, string>>({});
  const autoGenerationAttempted = useRef<Set<number>>(new Set());
  const taxInputs = useWorkflowStore((state) => state.taxInputs);
  const exchangeRate = useInvoiceStore((state) => state.exchangeRate);
  const itemExemptions = useInvoiceStore((state) => state.itemExemptions);

  useEffect(() => {
    if (!items.find((i) => i.id === activeId)) {
      setActiveId(items[0]?.id ?? null);
    }
  }, [items, activeId]);

  useEffect(() => {
    if (!items.length) return;
    const timer = window.setTimeout(() => {
      void api.registerClassificationLines({
        invoiceId: String(invId),
        lines: items.map((item) => ({
          lineId: item.id,
          originalDescription: item.desc,
          quantity: item.qty,
          unitPrice: item.price,
          productProfile: item.product_profile,
        })),
        taxInputs,
        exchangeRate: exchangeRate?.rate || 6.75,
        itemExemptions,
      }).catch(() => {
        // Recommendation generation also registers the active line; surface errors there.
      });
    }, 200);
    return () => window.clearTimeout(timer);
  }, [exchangeRate?.rate, invId, itemExemptions, items, taxInputs]);

  const activeItem = items.find((i) => i.id === activeId) || items[0] || null;
  const activeIndex = activeItem ? items.findIndex((i) => i.id === activeItem.id) : 0;
  const nearbyDescriptionsFor = useCallback((lineId: number) => {
    const index = items.findIndex((item) => item.id === lineId);
    if (index < 0) return [];
    return items
      .slice(Math.max(0, index - 2), Math.min(items.length, index + 3))
      .filter((item) => item.id !== lineId)
      .map((item) => item.desc);
  }, [items]);

  const goNextUnresolved = useCallback((fromId?: number) => {
    const start = fromId ?? activeItem?.id;
    const startIndex = items.findIndex((item) => item.id === start);
    const ordered = [
      ...items.slice(startIndex + 1),
      ...items.slice(0, Math.max(0, startIndex)),
    ];
    const next = ordered.find((item) => {
      const status = item.classification_status || "";
      return status !== "Applied" && status !== "AI Applied" && status !== "Clerk Edited";
    });
    if (next) setActiveId(next.id);
  }, [activeItem?.id, items]);

  const generateRecommendation = useCallback(async (
    target: LineItem,
    clarificationAnswer?: { id: string; value: string },
  ) => {
    setUpdatingLine(target.id);
    setRecommendationErrors((errors) => ({ ...errors, [target.id]: "" }));
    editItem(invId, target.id, "classification_status", "Generating Suggestions");
    try {
      let profile = target.product_profile;
      let predictedChapter = target.predictions?.chapter || null;
      let headingCandidates = target.predictions?.headings || [];

      // Prefer fresh product intelligence, but never block suggestions if it fails.
      try {
        const answers: ProductQuestionAnswer[] = [
          ...(target.question_answers || []),
        ];
        if (clarificationAnswer) {
          answers.push({
            question_id: `clarify_${clarificationAnswer.id}`,
            field: clarificationAnswer.id === "material" ? "material" : "primary_function",
            value: clarificationAnswer.value,
          });
        }
        if (profile?.productType || profile?.productName) {
          answers.push({
            question_id: "recommendation_product_type",
            field: "product_type",
            value: profile.productType || profile.productName || target.desc,
          });
        }
        const analyzed = await api.reanalyzeProductIntelligence({
          supplier_name: supplierName,
          line_id: target.id,
          description: target.desc,
          part_number: target.part_number,
          model_number: target.model_number,
          answers,
        });
        profile = {
          ...analyzed.result.profile,
          ...(profile || {}),
          productName: profile?.productName || analyzed.result.profile.productName,
          productType: profile?.productType || analyzed.result.profile.productType,
          material: clarificationAnswer?.id === "material"
            ? clarificationAnswer.value
            : (profile?.material || analyzed.result.profile.material),
          primaryUse: clarificationAnswer?.id === "primary_use"
            ? clarificationAnswer.value
            : (profile?.primaryUse || analyzed.result.profile.primaryUse),
          primaryFunction: clarificationAnswer?.id === "primary_use"
            ? clarificationAnswer.value
            : (profile?.primaryFunction || analyzed.result.profile.primaryFunction),
        };
        predictedChapter = analyzed.result.predictions.chapter;
        headingCandidates = analyzed.result.predictions.headings || [];
        editItem(invId, target.id, "product_profile", profile);
        editItem(invId, target.id, "predictions", analyzed.result.predictions);
        editItem(invId, target.id, "pending_questions", analyzed.result.pending_questions);
        editItem(invId, target.id, "explainability", analyzed.result.explainability);
        if (clarificationAnswer) {
          editItem(invId, target.id, "question_answers", answers);
        }
      } catch (error) {
        console.warn("[classification] product intelligence fallback", error);
      }

      const response = await api.generateLineRecommendation(target.id, {
        invoiceId: String(invId),
        originalDescription: target.desc,
        quantity: target.qty,
        unitPrice: target.price,
        productProfile: profile,
        predictedChapter,
        headingCandidates,
        resolutionId: target.evidence_resolution?.resolutionId,
        evidenceIds: target.evidence_resolution?.evidence
          ?.map((entry) => entry.id)
          .filter((id): id is number => Boolean(id)),
        productMasterId: target.evidence_resolution?.resolvedProduct?.productMasterId,
        clarificationAnswer,
      });

      console.log("[classification-ui] response", {
        lineId: target.id,
        status: response.status,
        recommendations: (response.recommendations || []).map((entry) => entry.code),
        question: response.question?.id || null,
      });

      editItem(invId, target.id, "classification_recommendation", response);
      if (response.interpretation) {
        const nextProfile = {
          ...(profile || analyzedFallbackProfile(target.desc)),
          productName: response.interpretation.productName,
          productType: response.interpretation.productType,
          material: response.interpretation.likelyMaterial,
          primaryUse: response.interpretation.primaryFunction,
          primaryFunction: response.interpretation.primaryFunction,
          industry: response.interpretation.industry,
          productFamily: response.interpretation.industry,
        };
        editItem(invId, target.id, "product_profile", nextProfile);
      }
      editItem(invId, target.id, "recommendation_evidence", target.evidence_resolution?.evidence || []);
      editItem(invId, target.id, "classification_status", mapLineStatus(response.status));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to generate recommendation.";
      setRecommendationErrors((errors) => ({ ...errors, [target.id]: message }));
      editItem(invId, target.id, "classification_status", "Failed");
    } finally {
      setUpdatingLine(null);
    }
  }, [editItem, invId, setUpdatingLine, supplierName]);

  const applyRecommendation = useCallback(async (
    target: LineItem,
    candidate: ClassificationRecommendationCandidate,
    edited: boolean,
  ) => {
    const source = edited
      ? "clerk_edited_ai_recommendation" as const
      : "ai_recommendation" as const;
    setUpdatingLine(target.id);
    setRecommendationErrors((errors) => ({ ...errors, [target.id]: "" }));
    try {
      const appliedResult = await api.applyLineRecommendation(target.id, {
        candidate,
        source,
        resolutionId: target.evidence_resolution?.resolutionId,
        evidenceIds: target.evidence_resolution?.evidence
          ?.map((entry) => entry.id)
          .filter((id): id is number => Boolean(id)),
        productMasterId: target.evidence_resolution?.resolvedProduct?.productMasterId,
      });
      candidate = appliedResult.candidate;
      const dutyRate = candidate.dutyRate === 0 ? "Free" : `${candidate.dutyRate}%`;
      editItem(invId, target.id, "tariff_code", candidate.code);
      editItem(invId, target.id, "tariff_description", candidate.description);
      editItem(invId, target.id, "category", candidate.description);
      editItem(invId, target.id, "duty_rate", dutyRate);
      editItem(invId, target.id, "vat_rate", `${candidate.vatRate}%`);
      editItem(invId, target.id, "levy_rate", `${candidate.levyRate || 0}%`);
      editItem(invId, target.id, "status", "done");
      editItem(invId, target.id, "source", edited ? "manual" : "ai");
      editItem(invId, target.id, "recommendation_source", source);
      editItem(invId, target.id, "classification_status", "Applied");
      editItem(invId, target.id, "notes", candidate.reason);
      editItem(invId, target.id, "requires_clerk_review", false);
      editItem(invId, target.id, "match_confidence", candidate.confidence ?? target.match_confidence ?? 0);
      if (target.product_resolution?.selected) {
        const product = target.product_resolution.selected;
        await api.confirmProductResolution({
          canonicalProductId: product.canonicalProductId,
          canonicalName: product.canonicalName,
          originalDescription: target.desc,
          supplier: supplierName,
          sku: target.part_number || target.model_number,
          brand: target.product_profile?.brand,
          productFamily: product.productFamily,
          typicalMaterials: product.typicalMaterials,
          typicalChapters: product.typicalChapters,
          commonUses: product.commonUses,
          typicalAttributes: product.typicalAttributes,
          approvedTariff: candidate.code,
          classificationApproval: true,
          answers: target.question_answers,
        });
      }
      await saveLearnedPair(target.desc, candidate.code, dutyRate, candidate.description);
      await persistProductLearning(
        { ...target, tariff_code: candidate.code, duty_rate: dutyRate },
        candidate.code,
        supplierName,
        String(invId),
      );
      setItemReview((reviews) => ({ ...reviews, [target.id]: "approved" }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to apply recommendation.";
      setRecommendationErrors((errors) => ({ ...errors, [target.id]: message }));
      editItem(invId, target.id, "classification_status", "Needs Manual Review");
    } finally {
      setUpdatingLine(null);
    }
  }, [
    editItem,
    invId,
    persistProductLearning,
    saveLearnedPair,
    setItemReview,
    setUpdatingLine,
    supplierName,
  ]);

  // Auto-generate suggestions for every line as quickly as possible.
  useEffect(() => {
    if (updatingLine !== null) return;
    const next = items.find((item) => {
      if (item.classification_recommendation) return false;
      if (autoGenerationAttempted.current.has(item.id)) return false;
      const status = item.classification_status || "";
      if (status === "Applied" || status === "AI Applied" || status === "Clerk Edited") return false;
      return Boolean(item.desc?.trim());
    });
    if (!next) return;
    autoGenerationAttempted.current.add(next.id);
    void generateRecommendation(next);
  }, [generateRecommendation, items, updatingLine]);

  const batchApply = async () => {
    const selected = items.filter((i) => selectedIds.includes(i.id));
    for (const item of selected) {
      const candidate = preferredCandidate(item);
      if (!candidate) continue;
      const strong = candidate.confidenceLabel === "Strong Match"
        || (candidate.confidence != null && candidate.confidence >= 0.8)
        || item.recommendation_source === "ai_recommendation";
      if (!strong && candidate.provisional) continue;
      await applyRecommendation(item, candidate, false);
    }
  };

  const batchRerun = async () => {
    const selected = items.filter((i) => selectedIds.includes(i.id));
    for (const item of selected) {
      autoGenerationAttempted.current.delete(item.id);
      await generateRecommendation(item);
    }
  };

  const selectedCanBatchApply = useMemo(() => {
    if (!selectedIds.length) return false;
    return selectedIds.every((id) => {
      const item = items.find((i) => i.id === id);
      const candidate = item ? preferredCandidate(item) : null;
      return Boolean(candidate && (candidate.confidenceLabel === "Strong Match" || !candidate.provisional));
    });
  }, [selectedIds, items]);

  if (!activeItem) {
    return <div className="p-6 text-sm dd-text-muted">No line items on this invoice.</div>;
  }

  return (
    <div className="dd-class-workspace">
      <div className="dd-class-batch">
        <div className="text-[12px] dd-text-muted">
          {selectedIds.length ? `${selectedIds.length} selected` : "Select lines for batch actions"}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Button
            variant="secondary"
            className="h-7 px-2 text-[10px]"
            disabled={!selectedCanBatchApply}
            title={selectedCanBatchApply ? "Apply strong recommendations to selected lines" : "Only strong matches can be batch-applied"}
            onClick={() => void batchApply()}
          >
            Batch apply strong matches
          </Button>
          <Button variant="secondary" className="h-7 px-2 text-[10px]" disabled={!selectedIds.length} onClick={() => void batchRerun()}>
            Regenerate selected
          </Button>
        </div>
      </div>

      <div className="dd-class-mobile-nav">
        <label className="text-[11px] dd-text-muted">Line</label>
        <select
          className="edit-cell w-full text-[12px]"
          value={activeItem.id}
          onChange={(e) => setActiveId(Number(e.target.value))}
        >
          {items.map((it, i) => (
            <option key={it.id} value={it.id}>
              #{i + 1} · {it.classification_status || "Generating Suggestions"} · {it.desc.slice(0, 40)}
            </option>
          ))}
        </select>
        <Button variant="secondary" className="h-8 text-[11px] w-full mt-1" onClick={() => setAssistantOpen(true)}>
          Open AI assistant
        </Button>
      </div>

      <div className="dd-class-panels">
        <div className={mobileLineOpen ? "dd-class-queue-wrap open" : "dd-class-queue-wrap"}>
          <LineQueuePanel
            items={items}
            activeId={activeItem.id}
            selectedIds={selectedIds}
            onSelect={(id) => {
              setActiveId(id);
              setMobileLineOpen(false);
            }}
            onToggleSelect={(id) =>
              setSelectedIds(
                selectedIds.includes(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id],
              )
            }
            onSelectAll={setSelectedIds}
          />
        </div>

        <div className="dd-product-first-centre">
          <ClassificationCentre
            item={activeItem}
            lineIndex={activeIndex}
            updating={updatingLine === activeItem.id}
            recommendationError={recommendationErrors[activeItem.id]}
            onEditField={(field, value) => editItem(invId, activeItem.id, field, value)}
            onEditProfileField={(field, value) => {
              if (!activeItem.product_profile) {
                editItem(invId, activeItem.id, "product_profile", {
                  ...analyzedFallbackProfile(activeItem.desc),
                  [field]: value,
                  ...(field === "productType"
                    ? { productName: value, normalizedName: value.toLowerCase() }
                    : {}),
                  ...(field === "primaryUse" ? { primaryFunction: value } : {}),
                });
                return;
              }
              const profile = {
                ...activeItem.product_profile,
                [field]: value,
                ...(field === "productType"
                  ? { productName: value, normalizedName: value.toLowerCase() }
                  : {}),
                ...(field === "primaryUse" ? { primaryFunction: value } : {}),
              };
              editItem(invId, activeItem.id, "product_profile", profile);
            }}
            onGenerateRecommendation={(clarificationAnswer) =>
              void generateRecommendation(activeItem, clarificationAnswer)
            }
            onApplyRecommendation={(candidate, edited) =>
              void applyRecommendation(activeItem, candidate, edited)
            }
            onSearchTariff={onNavigateTariffSearch}
            onApplyAndNext={() => {
              const candidate = preferredCandidate(activeItem);
              if (!candidate) return;
              void applyRecommendation(activeItem, candidate, false).then(() => goNextUnresolved(activeItem.id));
            }}
            onSkip={() => goNextUnresolved(activeItem.id)}
          />

          <section className="dd-class-card mt-3">
            <button
              type="button"
              className="flex w-full items-center justify-between text-left"
              onClick={() => setAdvancedOpen((value) => !value)}
            >
              <span className="text-sm font-semibold">Evidence & product memory</span>
              <span className="text-[11px] dd-text-muted">{advancedOpen ? "Hide" : "Show"}</span>
            </button>
            {advancedOpen && (
              <div className="mt-3">
                <ProductResolverPanel
                  item={activeItem}
                  supplier={supplierName}
                  shipmentId={shipmentId}
                  nearbyDescriptions={nearbyDescriptionsFor(activeItem.id)}
                  onStatusChange={() => {
                    // Evidence may improve ranking, but must not override suggestion-first statuses.
                  }}
                  onResolutionChange={(resolution: EvidenceProductResolution, confirmed) => {
                    editItem(invId, activeItem.id, "evidence_resolution", resolution);
                    editItem(invId, activeItem.id, "parsed_product_clues", resolution.parsed);
                    if (!confirmed) editItem(invId, activeItem.id, "product_confirmed", false);
                    const product = resolution.resolvedProduct;
                    if (confirmed && product) {
                      const candidate: ProductResolverCandidate = {
                        canonicalProductId: product.productMasterId || 0,
                        canonicalName: product.canonicalName,
                        confidence: resolution.confidence,
                        source: "manual",
                        matchedAlias: activeItem.desc,
                        industry: product.industry || null,
                        productFamily: product.productFamily || null,
                        typicalMaterials: product.material ? [product.material] : [],
                        typicalChapters: [],
                        commonUses: product.intendedUse || product.primaryFunction
                          ? [product.intendedUse || product.primaryFunction]
                          : [],
                        typicalAttributes: resolution.missingInformation,
                        approvedTariff: null,
                        supplierCount: 0,
                        previousImports: resolution.evidence.filter((entry) => entry.isApproved).length,
                        approvalRate: resolution.evidence.some((entry) => entry.isApproved) ? 1 : 0,
                        reasons: resolution.evidence.slice(0, 4).map((entry) => entry.explanation || entry.matchedValue),
                      };
                      setProductResolution(invId, activeItem.id, {
                        originalDescription: activeItem.desc,
                        normalizedQuery: resolution.parsed.coreDescription,
                        status: "identified",
                        confidence: resolution.confidence,
                        selected: candidate,
                        suggestions: [candidate],
                        missingInformation: resolution.missingInformation,
                        resolverPath: resolution.evidence.map((entry) => entry.source),
                      }, candidate, true);
                      // Improve ranking with confirmed identity, without clearing existing suggestions.
                      autoGenerationAttempted.current.delete(activeItem.id);
                      void generateRecommendation({
                        ...activeItem,
                        product_confirmed: true,
                        evidence_resolution: resolution,
                        product_profile: {
                          ...(activeItem.product_profile || analyzedFallbackProfile(activeItem.desc)),
                          productName: product.canonicalName,
                          productType: product.canonicalName,
                          material: product.material || activeItem.product_profile?.material || "Unknown",
                          primaryUse: product.intendedUse || product.primaryFunction || "Unknown",
                          primaryFunction: product.primaryFunction || product.intendedUse || "Unknown",
                          industry: product.industry || null,
                          productFamily: product.productFamily || null,
                        },
                      });
                    }
                  }}
                />
              </div>
            )}
          </section>
        </div>

        <div className="dd-class-assistant-desktop">
          <AiAssistantPanel
            item={activeItem}
            updating={updatingLine === activeItem.id}
            answers={activeItem.question_answers ?? []}
            onAnswer={(answers) => setLineAnswers(invId, activeItem.id, answers)}
            onUpdateClassification={async () => {
              setUpdatingLine(activeItem.id);
              try {
                const latest = { ...activeItem, question_answers: activeItem.question_answers ?? [] };
                await reanalyzeLine(invId, latest, latest.question_answers ?? [], supplierName);
                autoGenerationAttempted.current.delete(activeItem.id);
                await generateRecommendation(latest);
              } finally {
                setUpdatingLine(null);
              }
            }}
            onSearchSupplierHistory={onNavigateSupplierHistory}
          />
        </div>
      </div>

      {assistantOpen && (
        <div className="dd-class-drawer" role="dialog" aria-label="AI assistant">
          <div className="dd-class-drawer-backdrop" onClick={() => setAssistantOpen(false)} />
          <div className="dd-class-drawer-panel">
            <div className="flex justify-between items-center mb-2">
              <div className="font-semibold text-sm">AI Assistant</div>
              <button type="button" className="border-none bg-transparent text-sm" onClick={() => setAssistantOpen(false)}>
                ✕
              </button>
            </div>
            <AiAssistantPanel
              item={activeItem}
              updating={updatingLine === activeItem.id}
              answers={activeItem.question_answers ?? []}
              onAnswer={(answers) => setLineAnswers(invId, activeItem.id, answers)}
              onUpdateClassification={async () => {
                setUpdatingLine(activeItem.id);
                try {
                  await reanalyzeLine(invId, activeItem, activeItem.question_answers ?? [], supplierName);
                  autoGenerationAttempted.current.delete(activeItem.id);
                  await generateRecommendation(activeItem);
                } finally {
                  setUpdatingLine(null);
                }
              }}
              onSearchSupplierHistory={() => {
                setAssistantOpen(false);
                onNavigateSupplierHistory();
              }}
            />
          </div>
        </div>
      )}

      <div className="dd-class-sticky-actions">
        <Button
          className="h-9 flex-1 text-[12px]"
          disabled={updatingLine === activeItem.id}
          onClick={() => {
            const candidate = preferredCandidate(activeItem);
            if (candidate) void applyRecommendation(activeItem, candidate, false);
            else void generateRecommendation(activeItem);
          }}
        >
          {updatingLine === activeItem.id
            ? "Generating..."
            : preferredCandidate(activeItem)
              ? "Apply Recommendation"
              : "Generate Suggestions"}
        </Button>
        <Button
          variant="secondary"
          className="h-9 flex-1 text-[12px]"
          onClick={() => goNextUnresolved(activeItem.id)}
        >
          Next
        </Button>
        <Badge tone="blue">{activeIndex + 1}/{items.length}</Badge>
      </div>
    </div>
  );
}

function analyzedFallbackProfile(description: string) {
  return {
    productName: description.slice(0, 80),
    normalizedName: description.toLowerCase().slice(0, 80),
    industry: null,
    industryCode: null,
    productFamily: null,
    productType: description.slice(0, 80),
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
}
