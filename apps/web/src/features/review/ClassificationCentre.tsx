import { useEffect, useMemo, useState } from "react";
import type {
  ClassificationRecommendationCandidate,
  LineItem,
} from "@pas/shared-types";
import { getTariffRows } from "@pas/tariff-data";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  activeSuggestionCandidate,
  isLineApplied,
  isProvisionalRecommendation,
  mapRecommendationToLineStatus,
  recommendationCandidates,
  recommendationCardTitle,
  recommendationFingerprint,
} from "./classification-helpers";

type ProfileField = "productType" | "material" | "primaryUse" | "productFamily" | "brand";

type Props = {
  item: LineItem;
  lineIndex: number;
  updating?: boolean;
  recommendationError?: string | null;
  onEditField: (field: keyof LineItem, value: LineItem[keyof LineItem]) => void;
  onEditProfileField: (field: ProfileField, value: string) => void;
  onGenerateRecommendation: (clarificationAnswer?: { id: string; value: string }) => void;
  onApplyRecommendation: (
    candidate: ClassificationRecommendationCandidate,
    edited: boolean,
  ) => void;
  onSearchTariff: () => void;
  onApplyAndNext?: () => void;
  onSkip?: () => void;
  onUseSupplierEvidence?: () => void;
  onSearchSupplierAgain?: () => void;
  onIgnoreSupplierEvidence?: () => void;
};

function preferredList(item: LineItem): ClassificationRecommendationCandidate[] {
  return recommendationCandidates(item.classification_recommendation);
}

function confidenceTone(label?: string): "green" | "blue" | "gold" {
  if (label === "Strong Match") return "green";
  if (label === "Likely Match") return "blue";
  return "gold";
}

export function ClassificationCentre({
  item,
  lineIndex,
  updating,
  recommendationError,
  onEditField,
  onEditProfileField,
  onGenerateRecommendation,
  onApplyRecommendation,
  onSearchTariff,
  onApplyAndNext,
  onSkip,
  onUseSupplierEvidence,
  onSearchSupplierAgain,
  onIgnoreSupplierEvidence,
}: Props) {
  const recommendation = item.classification_recommendation;
  const candidates = useMemo(() => preferredList(item), [item]);
  const preferred = useMemo(() => activeSuggestionCandidate(item), [item]);
  const interpretation = recommendation?.interpretation;
  const question = recommendation?.question || null;
  const supplierEvidence = recommendation?.supplierEvidence || null;
  const [showAlternatives, setShowAlternatives] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<ClassificationRecommendationCandidate | null>(preferred);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const applied = isLineApplied(item);
  const recFingerprint = recommendationFingerprint(recommendation);

  useEffect(() => {
    setDraft(preferred);
    setEditing(false);
    setShowAlternatives(false);
  }, [preferred?.code, preferred?.description, preferred?.reason, recFingerprint, item.tariff_code, item.id]);

  useEffect(() => {
    console.log("[classification-ui]", {
      lineId: item.id,
      description: item.desc,
      status: recommendation?.status,
      recommendationCount: candidates.length,
      showApply: candidates.length > 0,
      classificationStatus: item.classification_status,
    });
  }, [item.id, item.desc, item.classification_status, recommendation?.status, candidates.length]);

  const interpretationText =
    interpretation?.productName
    || item.product_profile?.productType
    || item.product_profile?.productName
    || item.product_resolution?.selected?.canonicalName
    || "Interpreting product…";

  const interpretationDetail = [
    interpretation?.productType,
    interpretation?.likelyMaterial && interpretation.likelyMaterial !== "Unknown"
      ? `likely ${interpretation.likelyMaterial}`
      : null,
    interpretation?.primaryFunction && interpretation.primaryFunction !== "Unknown"
      ? `used for ${interpretation.primaryFunction}`
      : null,
  ].filter(Boolean).join(" · ");

  const provisional = isProvisionalRecommendation(recommendation);
  const derivedStatus = recommendation
    ? mapRecommendationToLineStatus(recommendation.status)
    : null;
  const statusLabel = applied
    ? (item.classification_status || "Applied")
    : derivedStatus
      || item.classification_status
      || (updating ? "Generating Suggestions" : candidates.length ? "Suggestion Ready" : "Generating Suggestions");
  const cardTitle = applied
    ? "Applied classification"
    : recommendationCardTitle(recommendation);

  const updateDraft = <K extends keyof ClassificationRecommendationCandidate>(
    field: K,
    value: ClassificationRecommendationCandidate[K],
  ) => {
    setDraft((current) => {
      if (!current) return current;
      const next = { ...current, [field]: value };
      if (field === "code" && typeof value === "string") {
        const hit = getTariffRows().find(
          (row) => row.code.replace(/\s/g, "").toUpperCase() === value.replace(/\s/g, "").toUpperCase(),
        );
        if (hit) {
          next.description = hit.desc;
          const dutyNum = hit.duty === "Free" || hit.duty === "Exempt" || hit.duty === "—"
            ? 0
            : Number.parseFloat(String(hit.duty).replace("%", "")) || 0;
          next.dutyRate = dutyNum;
        }
      }
      return next;
    });
  };

  return (
    <div className="dd-class-centre">
      <section className="dd-class-card">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <div className="text-[11px] dd-text-muted">Line #{lineIndex + 1}</div>
            <div className="text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: "var(--accent)" }}>
              Original description
            </div>
            <div className="mt-1 text-base font-semibold" style={{ color: "var(--text)" }}>
              {item.desc}
            </div>
          </div>
          <Badge tone={applied ? "green" : provisional ? "gold" : candidates.length ? "blue" : "gold"}>
            {statusLabel}
          </Badge>
        </div>

        <div className="mt-4">
          <div className="text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: "var(--accent)" }}>
            AI interpretation
          </div>
          <div className="mt-1 text-sm font-semibold" style={{ color: "var(--text)" }}>
            {interpretationText}
          </div>
          {interpretationDetail && (
            <div className="mt-1 text-[12px] dd-text-muted">{interpretationDetail}</div>
          )}
        </div>

        {item.extraction && (
          <div className="mt-4 rounded-lg border p-3 text-[12px]" style={{ borderColor: "var(--border)" }}>
            <div className="text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: "var(--accent)" }}>
              Extracted line
            </div>
            <div className="mt-2 space-y-1">
              <div><span className="dd-text-muted">Product:</span> {interpretationText}</div>
              <div><span className="dd-text-muted">Raw description:</span> {item.extraction.cleanDescription || item.desc}</div>
              {item.extraction.supplierSku && (
                <div><span className="dd-text-muted">SKU:</span> {item.extraction.supplierSku}</div>
              )}
              {item.extraction.countryOfOrigin && (
                <div><span className="dd-text-muted">Origin:</span> {item.extraction.countryOfOrigin}</div>
              )}
              {item.extraction.specifications && Object.keys(item.extraction.specifications).length > 0 && (
                <div>
                  <span className="dd-text-muted">Specifications:</span>
                  <ul className="mt-0.5 list-disc pl-4">
                    {Object.entries(item.extraction.specifications).map(([key, value]) => (
                      value == null || value === "" ? null : (
                        <li key={key}>{key}: {String(value)}</li>
                      )
                    ))}
                  </ul>
                </div>
              )}
              <div><span className="dd-text-muted">Quantity:</span> {item.qty} · <span className="dd-text-muted">Price:</span> {item.price}</div>
              <div><span className="dd-text-muted">Line type:</span> {item.line_type || "merchandise"}</div>
            </div>
            {item.extraction.needsExtractionReview && (
              <div className="dd-class-warn mt-2 text-[11px]">
                Product line may have been extracted incorrectly.
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button variant="secondary" onClick={onSearchTariff}>Classify Manually</Button>
                  <Button variant="secondary" onClick={() => onGenerateRecommendation()} disabled={updating}>
                    Classify Anyway
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {recommendationError && (
          <div className="dd-class-warn mt-3 text-[12px]">
            <strong>Classification failed.</strong> {recommendationError}
          </div>
        )}

        {(recommendation?.warnings?.length || 0) > 0 && (
          <div className="mt-2 text-[11px] dd-text-muted">
            {recommendation?.warnings?.join(" · ")}
          </div>
        )}
      </section>

      {(supplierEvidence
        || recommendation?.supplierSearchNotification
        || /packaging|bottle|container/i.test(interpretationText)
        || recommendation?.supplierSearchStatus === "pending"
        || recommendation?.supplierSearchStatus === "not_found") && (
        <section className="dd-class-card">
          <div className="text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: "var(--accent)" }}>
            Supplier Evidence
          </div>
          {recommendation?.supplierSearchNotification && (
            <div className="mt-2 text-[12px]" style={{ color: "var(--text)" }}>
              {recommendation.supplierSearchNotification}
            </div>
          )}
          {supplierEvidence ? (
            <div className="mt-2 space-y-1 text-[12px]">
              <div><span className="dd-text-muted">Supplier:</span> {supplierEvidence.supplier || "—"}</div>
              <div><span className="dd-text-muted">SKU:</span> {supplierEvidence.supplierSku || item.part_number || "—"}</div>
              <div>
                <span className="dd-text-muted">Supplier search result:</span>{" "}
                {supplierEvidence.excerpt || supplierEvidence.canonicalProduct}
              </div>
              <div>
                <span className="dd-text-muted">Resolved product:</span>{" "}
                <strong>{supplierEvidence.canonicalProduct}</strong>
              </div>
              <div>
                <span className="dd-text-muted">Evidence:</span>{" "}
                {supplierEvidence.sourceType.replace(/_/g, " ")}
                {supplierEvidence.material ? ` · ${supplierEvidence.material}` : ""}
                {supplierEvidence.emptyOrFilled ? ` · ${supplierEvidence.emptyOrFilled}` : ""}
              </div>
            </div>
          ) : (
            <div className="mt-2 text-[12px] dd-text-muted">
              No supplier product match yet. Search the supplier catalogue or website when the description is ambiguous.
            </div>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            {supplierEvidence && onUseSupplierEvidence && (
              <Button onClick={onUseSupplierEvidence} disabled={updating}>Use This Product</Button>
            )}
            {supplierEvidence?.sourceUrl && (
              <Button
                variant="secondary"
                onClick={() => window.open(supplierEvidence.sourceUrl, "_blank", "noopener,noreferrer")}
              >
                View Source
              </Button>
            )}
            {onSearchSupplierAgain && (
              <Button variant="secondary" onClick={onSearchSupplierAgain} disabled={updating}>
                {supplierEvidence ? "Search Again" : "Search Supplier"}
              </Button>
            )}
            {supplierEvidence && onIgnoreSupplierEvidence && (
              <Button variant="secondary" onClick={onIgnoreSupplierEvidence} disabled={updating}>
                Ignore
              </Button>
            )}
          </div>
        </section>
      )}

      {updating && !preferred ? (
        <section className="dd-class-card">
          <div className="text-sm font-semibold">Generating suggestions…</div>
          <div className="mt-1 text-[12px] dd-text-muted">
            Interpreting the description and ranking tariff candidates.
          </div>
        </section>
      ) : null}

      {recommendation?.status === "unable_to_classify" && !candidates.length ? (
        <section className="dd-class-card">
          <div className="dd-class-warn text-[12.5px]">
            <div className="font-semibold">Unable to classify automatically.</div>
            <div className="mt-1">Use manual search or answer the clarification question below.</div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="secondary" onClick={onSearchTariff}>Search Tariff</Button>
              <Button onClick={() => onGenerateRecommendation()} disabled={updating}>Try Again</Button>
            </div>
          </div>
        </section>
      ) : null}

      {preferred && draft ? (
        <section className="dd-class-card dd-recommendation-card">
          {(item.product_profile?.productType || item.product_profile?.productFamily) && (
            <div className="mb-3 rounded-lg px-3 py-2 text-[12px]" style={{ background: "var(--surface2)" }}>
              <div className="text-[10px] font-bold uppercase tracking-[0.12em]" style={{ color: "var(--accent)" }}>
                Product match
              </div>
              <div className="mt-0.5 font-semibold" style={{ color: "var(--text)" }}>
                {item.product_profile?.productType || item.product_profile?.productName || "Product"}
              </div>
              {item.product_profile?.productFamily && (
                <div className="mt-0.5 dd-text-muted">
                  Product family: {item.product_profile.productFamily}
                  {preferred.code?.replace(/\D/g, "").slice(0, 4)
                    ? ` · Likely heading: ${preferred.code.replace(/\D/g, "").slice(0, 4)}`
                    : ""}
                </div>
              )}
            </div>
          )}
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: "var(--accent)" }}>
                {cardTitle}
              </div>
              <div className="mt-1 font-mono text-xl font-bold" style={{ color: "var(--green)" }}>
                {editing ? (
                  <input
                    className="edit-cell w-[160px] font-mono"
                    value={draft.code}
                    onChange={(event) => updateDraft("code", event.target.value)}
                  />
                ) : preferred.code}
              </div>
            </div>
            <Badge tone={confidenceTone(preferred.confidenceLabel)}>
              {preferred.confidenceLabel || "Possible Match"}
            </Badge>
          </div>

          <div className="mt-3">
            {editing ? (
              <label className="dd-class-field">
                <span>Tariff description</span>
                <input
                  className="edit-cell w-full text-[12px]"
                  value={draft.description}
                  onChange={(event) => updateDraft("description", event.target.value)}
                />
              </label>
            ) : (
              <div className="text-[13px]" style={{ color: "var(--text)" }}>{preferred.description}</div>
            )}
          </div>

          {editing && (
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <label className="dd-class-field">
                <span>Duty %</span>
                <input
                  className="edit-cell w-full text-[12px]"
                  type="number"
                  value={draft.dutyRate}
                  onChange={(event) => updateDraft("dutyRate", Number(event.target.value))}
                />
              </label>
              <label className="dd-class-field">
                <span>VAT %</span>
                <input
                  className="edit-cell w-full text-[12px]"
                  type="number"
                  value={draft.vatRate}
                  onChange={(event) => updateDraft("vatRate", Number(event.target.value))}
                />
              </label>
              <label className="dd-class-field">
                <span>Interpreted product</span>
                <input
                  className="edit-cell w-full text-[12px]"
                  value={item.product_profile?.productType || ""}
                  onChange={(event) => onEditProfileField("productType", event.target.value)}
                />
              </label>
              <label className="dd-class-field">
                <span>Material</span>
                <input
                  className="edit-cell w-full text-[12px]"
                  value={item.product_profile?.material || ""}
                  onChange={(event) => onEditProfileField("material", event.target.value)}
                />
              </label>
              <label className="dd-class-field sm:col-span-2">
                <span>Function</span>
                <input
                  className="edit-cell w-full text-[12px]"
                  value={item.product_profile?.primaryUse || item.product_profile?.primaryFunction || ""}
                  onChange={(event) => onEditProfileField("primaryUse", event.target.value)}
                />
              </label>
            </div>
          )}

          <div className="mt-3 text-[12px]">
            <strong>Why:</strong>
            <ul className="mt-1 list-disc pl-4 space-y-0.5">
              <li>{preferred.reason}</li>
              {interpretation?.likelyMaterial && interpretation.likelyMaterial !== "Unknown" && (
                <li>Material: {interpretation.likelyMaterial}</li>
              )}
              {interpretation?.primaryFunction && interpretation.primaryFunction !== "Unknown" && (
                <li>Function: {interpretation.primaryFunction}</li>
              )}
              {interpretation?.industry && interpretation.industry !== "General" && (
                <li>Industry: {interpretation.industry}</li>
              )}
            </ul>
          </div>

          {question && (
            <div className="mt-2 text-[12px]" style={{ color: "var(--text)" }}>
              <strong>Needs confirmation:</strong>{" "}
              <span className="dd-text-muted">{question.prompt.replace(/\?$/, "")}</span>
            </div>
          )}

          {provisional && (
            <div className="dd-class-warn mt-2 text-[11px]">
              This is a provisional suggestion. Review carefully before applying.
            </div>
          )}

          {preferred.officialVerification && (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
              <Badge
                tone={
                  preferred.officialVerification.status === "verified"
                    ? "green"
                    : preferred.officialVerification.status === "cached"
                      ? "blue"
                      : "gold"
                }
              >
                {preferred.officialVerification.status === "verified"
                  ? "✓ TTBizLink verified"
                  : preferred.officialVerification.status === "cached"
                    ? "✓ Local TTBizLink tariff cache"
                    : preferred.officialVerification.status === "not_found"
                      ? "TTBizLink code not found"
                      : "TTBizLink lookup unavailable"}
              </Badge>
              <a
                href={preferred.officialVerification.url}
                target="_blank"
                rel="noreferrer"
                className="underline dd-text-muted"
              >
                View official tariff lookup
              </a>
            </div>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              onClick={() => {
                const candidate = editing ? draft : preferred;
                if (!candidate?.code) return;
                onApplyRecommendation(candidate, editing);
              }}
              disabled={(applied && !editing) || !draft?.code}
            >
              {applied && !editing
                ? "Applied"
                : editing
                  ? "Apply Edited Classification"
                  : "Apply Recommendation"}
            </Button>
            {onApplyAndNext && (
              <Button
                variant="secondary"
                onClick={onApplyAndNext}
                disabled={!preferred?.code || (applied && !editing)}
              >
                Apply & Next
              </Button>
            )}
            <Button variant="secondary" onClick={() => setEditing((value) => !value)}>
              {editing ? "Cancel Edit" : "Edit Classification"}
            </Button>
            {candidates.length > 1 && (
              <Button variant="secondary" onClick={() => setShowAlternatives((value) => !value)}>
                {showAlternatives ? "Hide Alternatives" : "View Alternatives"}
              </Button>
            )}
            {onSkip && (
              <Button variant="secondary" onClick={onSkip}>Skip</Button>
            )}
            <Button variant="secondary" onClick={onSearchTariff}>
              Search Tariff
            </Button>
            {question && (
              <Button
                variant="secondary"
                onClick={() => {
                  const el = document.getElementById("dd-clarification-question");
                  el?.scrollIntoView({ behavior: "smooth", block: "nearest" });
                }}
              >
                Answer Question
              </Button>
            )}
            <Button variant="secondary" onClick={() => onGenerateRecommendation()} disabled={updating}>
              {updating ? "Generating..." : "Regenerate"}
            </Button>
          </div>

          {showAlternatives && candidates.length > 1 && (
            <div className="mt-4 border-t pt-3 space-y-2" style={{ borderColor: "var(--border)" }}>
              <div className="text-[11px] font-semibold">Alternatives</div>
              {candidates.slice(1).map((alternative) => (
                <div
                  key={alternative.code}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-2"
                  style={{ borderColor: "var(--border)" }}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[12px] font-semibold">{alternative.code}</span>
                      <Badge tone={confidenceTone(alternative.confidenceLabel)}>
                        {alternative.confidenceLabel || "Possible Match"}
                      </Badge>
                    </div>
                    <div className="text-[11px] dd-text-muted">{alternative.description}</div>
                    <div className="text-[11px] mt-0.5">{alternative.reason}</div>
                  </div>
                  <Button
                    variant="secondary"
                    className="h-7 px-2 text-[10px]"
                    onClick={() => onApplyRecommendation(alternative, false)}
                  >
                    Apply This Option
                  </Button>
                </div>
              ))}
            </div>
          )}
        </section>
      ) : null}

      {question && (
        <section id="dd-clarification-question" className="dd-class-card">
          <div className="text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: "var(--accent)" }}>
            Answer one question
          </div>
          <div className="mt-1 text-sm font-semibold">{question.prompt}</div>
          <div className="mt-1 text-[11px] dd-text-muted">
            Suggestions stay visible. Answering only reranks them.
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {question.options.map((option) => (
              <button
                key={option}
                type="button"
                className="rounded-full border px-2.5 py-1 text-[11px]"
                style={{ borderColor: "var(--border)" }}
                disabled={updating}
                onClick={() => onGenerateRecommendation({ id: question.id, value: option })}
              >
                {option}
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="dd-class-card">
        <button
          type="button"
          className="flex w-full items-center justify-between text-left"
          onClick={() => setAdvancedOpen((value) => !value)}
        >
          <span className="text-sm font-semibold">Advanced details</span>
          <span className="text-[11px] dd-text-muted">{advancedOpen ? "Hide" : "Show"}</span>
        </button>
        {advancedOpen && (
          <div className="mt-3 dd-class-grid">
            <label className="dd-class-field">
              <span>Original description</span>
              <input
                className="edit-cell w-full text-[12px]"
                value={item.desc}
                onChange={(event) => onEditField("desc", event.target.value)}
              />
            </label>
            <label className="dd-class-field">
              <span>Identified item</span>
              <input
                className="edit-cell w-full text-[12px]"
                value={item.product_profile?.productType || item.product_profile?.productName || ""}
                onChange={(event) => onEditProfileField("productType", event.target.value)}
              />
            </label>
            <label className="dd-class-field">
              <span>Material</span>
              <input
                className="edit-cell w-full text-[12px]"
                value={item.product_profile?.material || ""}
                onChange={(event) => onEditProfileField("material", event.target.value)}
              />
            </label>
            <label className="dd-class-field">
              <span>Primary use</span>
              <input
                className="edit-cell w-full text-[12px]"
                value={item.product_profile?.primaryUse || item.product_profile?.primaryFunction || ""}
                onChange={(event) => onEditProfileField("primaryUse", event.target.value)}
              />
            </label>
            <label className="dd-class-field">
              <span>Product family</span>
              <input
                className="edit-cell w-full text-[12px]"
                value={item.product_profile?.productFamily || ""}
                onChange={(event) => onEditProfileField("productFamily", event.target.value)}
              />
            </label>
            <label className="dd-class-field">
              <span>Brand</span>
              <input
                className="edit-cell w-full text-[12px]"
                value={item.product_profile?.brand || ""}
                onChange={(event) => onEditProfileField("brand", event.target.value)}
              />
            </label>
          </div>
        )}
      </section>
    </div>
  );
}
