import { useEffect, useMemo, useRef, useState } from "react";
import type {
  EvidenceProductResolution,
  EvidenceResolvedProduct,
  LineItem,
  ProductEvidenceSource,
} from "@pas/shared-types";
import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronUp,
  FileSearch,
  Search,
  Sparkles,
} from "lucide-react";
import { api } from "@/lib/api-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type Props = {
  item: LineItem;
  supplier?: string | null;
  shipmentId?: string;
  nearbyDescriptions?: string[];
  onResolutionChange: (resolution: EvidenceProductResolution, confirmed: boolean) => void;
  onStatusChange?: (status: "Parsing Description" | "Searching Evidence") => void;
};

const SOURCE_LABELS: Record<ProductEvidenceSource, string> = {
  supplier_product_code: "Exact supplier product-code match",
  previous_approved: "Previous approved import",
  product_master: "Product Master match",
  supplier_catalogue: "Supplier catalogue",
  alias: "Alias match",
  brand_manufacturer: "Brand or manufacturer match",
  similar_import: "Similar previous import",
  attached_document: "Attached shipment document",
  ai_interpretation: "AI product interpretation",
  external_lookup: "External product information",
};

function pct(value: number): number {
  return Math.round(Math.max(0, Math.min(1, value)) * 100);
}

function evidenceTone(source: ProductEvidenceSource, approved: boolean) {
  if (approved) return "green" as const;
  if (source === "external_lookup" || source === "ai_interpretation") return "gold" as const;
  return "blue" as const;
}

function materialChoices(name: string): string[] {
  const lower = name.toLowerCase();
  if (lower.includes("towel")) return ["Cotton", "Microfibre", "Paper", "Synthetic textile", "Other", "Unknown"];
  if (lower.includes("shower cap")) return ["Plastic", "Nonwoven textile", "Rubber", "Other", "Unknown"];
  return ["Plastic", "Metal", "Paper", "Rubber", "Textile", "Chemical mixture", "Other", "Unknown"];
}

function useChoices(name: string): string[] {
  if (name.toLowerCase().includes("activator")) {
    return ["Rubber bonding", "Adhesive curing", "Paint or coating", "Chemical processing", "Other", "Unknown"];
  }
  return [];
}

export function ProductResolverPanel({
  item,
  supplier,
  shipmentId,
  nearbyDescriptions = [],
  onResolutionChange,
  onStatusChange,
}: Props) {
  const [resolution, setResolution] = useState<EvidenceProductResolution | null>(
    item.evidence_resolution || null,
  );
  const [resolutionId, setResolutionId] = useState<number | undefined>(
    item.evidence_resolution?.resolutionId,
  );
  const [query, setQuery] = useState(item.desc);
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const requestId = useRef(0);
  const sdsInputRef = useRef<HTMLInputElement>(null);

  const publish = (next: EvidenceProductResolution, confirmed = false) => {
    setResolution(next);
    onResolutionChange(next, confirmed);
  };

  const runResolve = async (description: string) => {
    const id = ++requestId.current;
    setLoading(true);
    onStatusChange?.("Parsing Description");
    setError("");
    setNotice("");
    try {
      onStatusChange?.("Searching Evidence");
      const response = await api.resolveProductEvidence({
        invoiceLineId: item.id,
        description,
        supplierName: supplier || undefined,
        shipmentId,
        nearbyDescriptions,
      });
      if (id !== requestId.current) return;
      setResolutionId(response.resolutionId);
      publish(response, false);
    } catch (caught) {
      if (id !== requestId.current) return;
      setError(caught instanceof Error ? caught.message : "Evidence search unavailable.");
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  };

  useEffect(() => {
    setQuery(item.desc);
    if (item.evidence_resolution) {
      setResolution(item.evidence_resolution);
      setResolutionId(item.evidence_resolution.resolutionId);
      return;
    }
    void runResolve(item.desc);
    // Resolve once when a line becomes active.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);

  const product = resolution?.resolvedProduct || null;
  const confirmed = Boolean(item.product_confirmed && product);
  const missing = resolution?.missingInformation || [];
  const approvedEvidence = useMemo(
    () => resolution?.evidence.filter((entry) => entry.isApproved) || [],
    [resolution],
  );

  const updateProduct = (patch: Partial<EvidenceResolvedProduct>) => {
    if (!resolution) return;
    const base: EvidenceResolvedProduct = resolution.resolvedProduct || {
      productMasterId: null,
      canonicalName: "",
      displayName: "",
      productFamily: "",
      industry: "",
      brand: resolution.parsed.possibleBrand,
      manufacturer: resolution.parsed.possibleManufacturer,
      productCode: resolution.parsed.possibleProductCode,
      material: resolution.parsed.attributes.material,
      primaryFunction: "",
      intendedUse: "",
      attributes: {},
    };
    const nextProduct = { ...base, ...patch };
    const nextMissing = resolution.missingInformation.filter((field) => {
      if (patch.material !== undefined && field === "Material or composition") return false;
      if ((patch.intendedUse !== undefined || patch.primaryFunction !== undefined)
        && ["Primary function or intended use", "Activator use"].includes(field)) return false;
      if (patch.attributes?.physicalForm && field === "Physical form") return false;
      if (patch.attributes?.sdsAvailability && field === "SDS availability") return false;
      if (patch.attributes?.disposable && field === "Disposable or reusable") return false;
      return true;
    });
    publish({
      ...resolution,
      resolvedProduct: nextProduct,
      status: resolution.status === "unresolved" ? "possible_matches" : resolution.status,
      missingInformation: nextMissing,
    }, confirmed);
  };

  const confirm = async () => {
    if (!resolution?.resolvedProduct?.canonicalName.trim()) {
      setError("Enter or select a product before confirming.");
      return;
    }
    setConfirming(true);
    setError("");
    try {
      const response = await api.confirmEvidenceProduct({
        invoiceLineId: item.id,
        resolutionId: resolutionId || resolution.resolutionId,
        productMasterId: resolution.resolvedProduct.productMasterId,
        resolvedProduct: resolution.resolvedProduct,
        rawDescription: item.desc,
        parsedProductCode: resolution.parsed.possibleProductCode,
        supplierName: supplier || undefined,
        createAlias: true,
        evidenceIds: resolution.evidence.map((entry) => entry.id).filter((id): id is number => Boolean(id)),
        previousProduct: item.evidence_resolution?.resolvedProduct || null,
      });
      const next: EvidenceProductResolution = {
        ...resolution,
        resolutionId: resolutionId || resolution.resolutionId,
        status: "resolved",
        confidence: Math.max(resolution.confidence, 0.98),
        resolvedProduct: {
          ...resolution.resolvedProduct,
          productMasterId: response.productMasterId,
        },
      };
      setEditing(false);
      setNotice(
        response.requiresSupervisorReview
          ? "Correction saved. Shared Product Master changes require supervisor review."
          : "Product confirmed. Tariff recommendation can now be generated.",
      );
      publish(next, true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not confirm product.");
    } finally {
      setConfirming(false);
    }
  };

  const selectMatch = (index: number) => {
    if (!resolution) return;
    const match = resolution.possibleMatches[index];
    if (!match) return;
    publish({
      ...resolution,
      resolvedProduct: match.product,
      confidence: match.confidence,
      status: "possible_matches",
      missingInformation: [
        ...(match.product.material ? [] : ["Material or composition"]),
        ...(match.product.primaryFunction ? [] : ["Primary function or intended use"]),
      ],
    });
  };

  const externalLookup = async () => {
    setLoading(true);
    setError("");
    try {
      const response = await api.externalProductLookup({
        invoiceLineId: item.id,
        query: resolution?.parsed.possibleProductCode || query,
      });
      setNotice(`${response.label}. ${response.message}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "External lookup unavailable.");
    } finally {
      setLoading(false);
    }
  };

  const uploadSds = async (file: File) => {
    if (!shipmentId) {
      setError("Save or upload the commercial invoice before attaching an SDS.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      await api.processDocument(
        file,
        (job) => setNotice(
          `${job.currentStage || "Processing SDS"} · ${job.progressPercent}%`,
        ),
        { shipmentId, documentType: "sds" },
      );
      await runResolve(query);
      setNotice("SDS processed and added to this shipment's product evidence.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not process the SDS.");
    } finally {
      setLoading(false);
    }
  };

  const productName = product?.canonicalName || "";
  const materials = materialChoices(productName);
  const uses = useChoices(productName);
  const showDisposable = productName.toLowerCase().includes("shower cap");
  const showForm = productName.toLowerCase().includes("activator");

  return (
    <section className="dd-resolver-card" aria-label="Evidence-Based Product Resolver">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="dd-resolver-eyebrow">
            {confirmed ? <Check className="h-3.5 w-3.5" /> : <Sparkles className="h-3.5 w-3.5" />}
            {loading
              ? "Searching evidence"
              : confirmed
                ? "Product confirmed"
                : resolution?.status === "resolved"
                  ? "Product resolved"
                  : resolution?.status === "possible_matches"
                    ? "Possible matches"
                    : "Product Resolver"}
          </div>
          <h2 className="mt-1 text-lg font-bold" style={{ color: "var(--text)" }}>
            {product?.displayName || product?.canonicalName || "What is this product?"}
          </h2>
          <div className="mt-0.5 text-[12px] dd-text-muted">
            Duty Desk treats the invoice text as clues and verifies product identity before tariff classification.
          </div>
        </div>
        {resolution && (
          <div className="text-right">
            <div
              className="text-2xl font-bold"
              style={{ color: resolution.confidence >= 0.9 ? "var(--green)" : "var(--gold)" }}
            >
              {pct(resolution.confidence)}%
            </div>
            <div className="text-[10px] uppercase tracking-wide dd-text-muted">Product confidence</div>
          </div>
        )}
      </div>

      <div className="mt-3 rounded-md border p-2.5" style={{ borderColor: "var(--border)" }}>
        <div className="text-[10px] font-semibold uppercase tracking-wide dd-text-muted">Original description</div>
        <div className="mt-0.5 font-mono text-[12px] font-semibold">{item.desc}</div>
      </div>

      <div className="dd-resolver-search mt-3">
        <Search className="h-4 w-4 shrink-0 dd-text-muted" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void runResolve(query);
          }}
          placeholder="Search Product Master, aliases, brands or supplier terminology…"
          aria-label="Product evidence search"
        />
        <Button
          variant="secondary"
          className="h-7 px-2 text-[10px]"
          disabled={loading || query.trim().length < 2}
          onClick={() => void runResolve(query)}
        >
          {loading ? "Searching…" : "Search"}
        </Button>
      </div>

      {error && (
        <div className="dd-class-warn mt-2 flex items-start gap-1.5 text-[11px]">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {error}
        </div>
      )}
      {notice && <div className="mt-2 rounded-md border p-2 text-[11px] dd-text-muted">{notice}</div>}

      {resolution?.parsed && (
        <div className="mt-3">
          <div className="text-[10px] font-semibold uppercase tracking-wide dd-text-muted">Description parser</div>
          <div className="mt-1 flex flex-wrap gap-1">
            {resolution.parsed.possibleProductCode && (
              <Badge tone="blue">Code: {resolution.parsed.possibleProductCode}</Badge>
            )}
            {resolution.parsed.possibleBrand && <Badge tone="blue">Brand: {resolution.parsed.possibleBrand}</Badge>}
            {resolution.parsed.productWords.map((word) => <Badge key={word} tone="default">{word}</Badge>)}
            {resolution.parsed.attributes.colour && (
              <Badge tone="default">Colour: {resolution.parsed.attributes.colour}</Badge>
            )}
            {resolution.parsed.attributes.dimensions && (
              <Badge tone="default">Size: {resolution.parsed.attributes.dimensions}</Badge>
            )}
            {resolution.parsed.attributes.quantity && (
              <Badge tone="default">Qty: {resolution.parsed.attributes.quantity}</Badge>
            )}
            {resolution.parsed.unresolvedTokens.map((token) => (
              <Badge key={token} tone="gold">Unresolved: {token}</Badge>
            ))}
          </div>
        </div>
      )}

      {resolution?.relatedProductGroup && (
        <div className="mt-3 rounded-md border p-2 text-[11px]" style={{ borderColor: "var(--border)" }}>
          <strong>Related product group detected:</strong> {resolution.relatedProductGroup}
          <div className="dd-text-muted">Used as identity context only; tariffs are not copied between lines.</div>
        </div>
      )}

      {product && (
        <div className="dd-resolver-profile mt-3">
          <div className="text-[10px] font-semibold uppercase tracking-wide dd-text-muted">Product identified</div>
          {editing ? (
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {[
                ["canonicalName", "Product name", product.canonicalName],
                ["productCode", "Product code", product.productCode],
                ["brand", "Brand / product line", product.brand],
                ["manufacturer", "Manufacturer", product.manufacturer],
                ["productFamily", "Product family", product.productFamily],
                ["material", "Material / composition", product.material],
                ["primaryFunction", "Primary use", product.primaryFunction],
                ["intendedUse", "Intended use", product.intendedUse],
              ].map(([field, label, value]) => (
                <label key={field} className="text-[10px] dd-text-muted">
                  {label}
                  <input
                    className="edit-cell mt-0.5 w-full text-[11px]"
                    value={value}
                    onChange={(event) => updateProduct({ [field]: event.target.value })}
                  />
                </label>
              ))}
            </div>
          ) : (
            <div className="dd-resolver-profile-grid mt-2">
              <div><span>Product code</span><strong>{product.productCode || "—"}</strong></div>
              <div><span>Brand / product line</span><strong>{product.brand || "—"}</strong></div>
              <div><span>Manufacturer</span><strong>{product.manufacturer || "—"}</strong></div>
              <div><span>Product family</span><strong>{product.productFamily || "—"}</strong></div>
              <div><span>Primary use</span><strong>{product.primaryFunction || product.intendedUse || "Not confirmed"}</strong></div>
              <div><span>Material / composition</span><strong>{product.material || "Not confirmed"}</strong></div>
            </div>
          )}

          {missing.length > 0 && (
            <div className="mt-2 text-[11px]" style={{ color: "var(--gold)" }}>
              Missing information: {missing.join(" · ")}
            </div>
          )}

          <div className="mt-3 flex flex-wrap gap-2">
            <Button disabled={confirming || !product.canonicalName.trim()} onClick={() => void confirm()}>
              {confirming ? "Confirming…" : confirmed ? "Product Confirmed" : "Confirm Product"}
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setEditing(false);
                if (resolution) publish({ ...resolution, resolvedProduct: null, status: "possible_matches" });
              }}
            >
              Choose Another
            </Button>
            <Button variant="secondary" onClick={() => setEditing((value) => !value)}>
              {editing ? "Done Editing" : "Edit Details"}
            </Button>
          </div>
        </div>
      )}

      {resolution && product && (
        <div className="mt-3 rounded-md border p-2.5" style={{ borderColor: "var(--border)" }}>
          <div className="text-[11px] font-semibold">Quick clarification</div>
          {!product.material && (
            <div className="mt-2">
              <div className="text-[11px] dd-text-muted">What material is it made from?</div>
              <div className="mt-1 flex flex-wrap gap-1">
                {materials.map((choice) => (
                  <Button
                    key={choice}
                    variant="secondary"
                    className="h-7 px-2 text-[10px]"
                    onClick={() => updateProduct({ material: choice === "Unknown" ? "" : choice })}
                  >
                    {choice}
                  </Button>
                ))}
              </div>
            </div>
          )}
          {!product.intendedUse && uses.length > 0 && (
            <div className="mt-2">
              <div className="text-[11px] dd-text-muted">What is the product used for?</div>
              <div className="mt-1 flex flex-wrap gap-1">
                {uses.map((choice) => (
                  <Button
                    key={choice}
                    variant="secondary"
                    className="h-7 px-2 text-[10px]"
                    onClick={() => updateProduct({
                      intendedUse: choice === "Unknown" ? "" : choice,
                      primaryFunction: choice === "Unknown" ? "" : choice,
                    })}
                  >
                    {choice}
                  </Button>
                ))}
              </div>
            </div>
          )}
          {showForm && (
            <div className="mt-2">
              <div className="text-[11px] dd-text-muted">What form is it?</div>
              <div className="mt-1 flex flex-wrap gap-1">
                {["Liquid", "Paste", "Powder", "Aerosol", "Other", "Unknown"].map((choice) => (
                  <Button
                    key={choice}
                    variant="secondary"
                    className="h-7 px-2 text-[10px]"
                    onClick={() => updateProduct({
                      attributes: {
                        ...(product.attributes || {}),
                        physicalForm: choice,
                      },
                    })}
                  >
                    {choice}
                  </Button>
                ))}
              </div>
              <div className="mt-2 text-[11px] dd-text-muted">Do you have an SDS?</div>
              <div className="mt-1 flex flex-wrap gap-1">
                <Button
                  variant="secondary"
                  className="h-7 px-2 text-[10px]"
                  disabled={!shipmentId || loading}
                  onClick={() => sdsInputRef.current?.click()}
                >
                  Upload SDS
                </Button>
                <input
                  ref={sdsInputRef}
                  type="file"
                  accept=".pdf,image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) {
                      updateProduct({
                        attributes: { ...(product.attributes || {}), sdsAvailability: "Uploaded" },
                      });
                      void uploadSds(file);
                    }
                    event.target.value = "";
                  }}
                />
                <Button
                  variant="secondary"
                  className="h-7 px-2 text-[10px]"
                  onClick={() => updateProduct({
                    attributes: { ...(product.attributes || {}), sdsAvailability: "No SDS available" },
                  })}
                >
                  No SDS available
                </Button>
              </div>
            </div>
          )}
          {showDisposable && (
            <div className="mt-2">
              <div className="text-[11px] dd-text-muted">Is it disposable?</div>
              <div className="mt-1 flex gap-1">
                {["Yes", "No", "Unknown"].map((choice) => (
                  <Button
                    key={choice}
                    variant="secondary"
                    className="h-7 px-2 text-[10px]"
                    onClick={() => updateProduct({
                      attributes: { ...(product.attributes || {}), disposable: choice },
                    })}
                  >
                    {choice}
                  </Button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {resolution?.status === "possible_matches" && resolution.possibleMatches.length > 0 && !product && (
        <div className="mt-3">
          <div className="text-sm font-semibold">Did you mean?</div>
          <div className="mt-2 space-y-2">
            {resolution.possibleMatches.map((match, index) => (
              <div key={`${match.product.canonicalName}-${index}`} className="dd-resolver-option">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-[12px] font-semibold">{index + 1}. {match.product.canonicalName}</div>
                    <div className="mt-0.5 text-[10px] dd-text-muted">Evidence: {match.evidenceSummary || "Product Master similarity"}</div>
                  </div>
                  <strong style={{ color: match.confidence >= 0.8 ? "var(--green)" : "var(--gold)" }}>
                    {pct(match.confidence)}%
                  </strong>
                </div>
                <Button className="mt-2 h-7 text-[10px]" onClick={() => selectMatch(index)}>Select</Button>
              </div>
            ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => void runResolve(query)}>Search Product Master</Button>
            <Button
              variant="secondary"
              onClick={() => {
                updateProduct({ canonicalName: query, displayName: query });
                setEditing(true);
              }}
            >
              Enter Product Manually
            </Button>
          </div>
        </div>
      )}

      {resolution?.status === "unresolved" && (
        <div className="dd-class-warn mt-3">
          <div className="font-semibold text-[12px]">Product could not be confidently identified.</div>
          <div className="mt-1 text-[11px] dd-text-muted">
            No tariff recommendation will be generated from a vague code or unsupported keyword.
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => void runResolve(query)}>Search Previous Imports</Button>
            <Button variant="secondary" disabled={!shipmentId} onClick={() => void runResolve(query)}>
              <FileSearch className="mr-1 h-3.5 w-3.5" /> Search Attached Documents
            </Button>
            <Button variant="secondary" onClick={() => void runResolve(query)}>Search Product Master</Button>
            <Button
              variant="secondary"
              onClick={() => {
                updateProduct({ canonicalName: query, displayName: query });
                setEditing(true);
              }}
            >
              Enter Product Name
            </Button>
            <Button variant="secondary" onClick={() => void externalLookup()}>Optional Web Lookup</Button>
            <Button variant="secondary" onClick={() => setNotice("Supplier clarification requested; product remains unresolved.")}>
              Ask Supplier
            </Button>
          </div>
        </div>
      )}

      {resolution && resolution.evidence.length > 0 && (
        <div className="mt-3 border-t pt-3" style={{ borderColor: "var(--border)" }}>
          <button
            type="button"
            className="flex w-full items-center justify-between text-left text-[11px] font-semibold"
            onClick={() => setEvidenceOpen((value) => !value)}
          >
            <span>
              Evidence used ({resolution.evidence.length})
              {approvedEvidence.length > 0 && ` · ${approvedEvidence.length} approved`}
            </span>
            {evidenceOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
          {evidenceOpen && (
            <div className="mt-2 space-y-2">
              {resolution.evidence.map((entry, index) => (
                <div key={`${entry.source}-${entry.matchedValue}-${index}`} className="rounded-md border p-2">
                  <div className="flex flex-wrap items-center gap-1">
                    <Badge tone={evidenceTone(entry.source, entry.isApproved)}>
                      {entry.isApproved ? "✓" : "○"} {SOURCE_LABELS[entry.source]}
                    </Badge>
                    <span className="text-[10px] font-semibold">{pct(entry.confidence)}%</span>
                  </div>
                  <div className="mt-1 text-[11px]">{entry.explanation || entry.matchedValue}</div>
                  {entry.documentReference && (
                    <div className="mt-0.5 text-[10px] dd-text-muted">{entry.documentReference}</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
