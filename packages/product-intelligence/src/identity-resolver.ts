import type {
  AbbreviationDictionaryEntry,
  LineContextSummary,
  ParsedLineDescription,
  ProductIdentityLearningEntry,
  ProductQuestion,
  SupplierCatalogueEntry,
  SupplierClassificationEntry,
} from "@pas/shared-types";
import { applyClerkIdentityAnswers, parseInvoiceLineDescription } from "./line-parser";
import { identifiersMatch, normalizeIdentifierVariants, splitSkuVariant, stripIdentifierNoise } from "./sku-normalize";

export interface IdentityResolverInput {
  description: string;
  supplier?: string | null;
  part_number?: string | null;
  model_number?: string | null;
  answers?: Array<{ field: string; value: string }>;
  abbreviations?: AbbreviationDictionaryEntry[];
  catalogue?: SupplierCatalogueEntry[];
  identityLearning?: ProductIdentityLearningEntry[];
  supplierHistory?: SupplierClassificationEntry[];
  adjacentDescriptions?: string[];
  knownBrand?: string | null;
}

export interface IdentityResolverResult {
  parsed: ParsedLineDescription;
  context: LineContextSummary;
  catalogueHit: SupplierCatalogueEntry | null;
  learningHit: ProductIdentityLearningEntry | null;
  historyHit: SupplierClassificationEntry | null;
  blockClassification: boolean;
  suggestedHsCode: string | null;
  dutyRate: string | null;
  path: string[];
}

function supplierKey(name: string | null | undefined): string {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function findCatalogueMatch(
  parsed: ParsedLineDescription,
  catalogue: SupplierCatalogueEntry[] | undefined,
  supplier?: string | null,
): SupplierCatalogueEntry | null {
  if (!catalogue?.length) return null;
  const sKey = supplierKey(supplier);
  const scoped = catalogue.filter(
    (c) =>
      c.status === "active" &&
      (!sKey || !c.normalized_supplier || c.normalized_supplier.includes(sKey.split(" ")[0] || sKey) || sKey.includes(c.normalized_supplier)),
  );
  const pool = scoped.length ? scoped : catalogue.filter((c) => c.status === "active");

  const skuCandidates = [parsed.sku, parsed.normalizedSku, parsed.partNumber, parsed.basePartNumber].filter(
    Boolean,
  ) as string[];

  for (const sku of skuCandidates) {
    const hit = pool.find(
      (c) =>
        identifiersMatch(c.supplier_sku, sku) ||
        identifiersMatch(c.normalized_sku, sku) ||
        identifiersMatch(c.manufacturer_part_number, sku),
    );
    if (hit) return hit;
  }

  // Base part family match (weaker)
  if (parsed.basePartNumber) {
    const base = stripIdentifierNoise(parsed.basePartNumber);
    const hit = pool.find(
      (c) =>
        c.base_part_number &&
        stripIdentifierNoise(c.base_part_number) === base &&
        c.approval_status === "verified",
    );
    if (hit) return hit;
  }
  return null;
}

function findLearningMatch(
  parsed: ParsedLineDescription,
  learning: ProductIdentityLearningEntry[] | undefined,
  supplier?: string | null,
): ProductIdentityLearningEntry | null {
  if (!learning?.length) return null;
  const sKey = supplierKey(supplier);
  const skuCandidates = [parsed.sku, parsed.normalizedSku, parsed.partNumber, parsed.basePartNumber].filter(
    Boolean,
  ) as string[];
  for (const row of learning.filter((l) => l.approved)) {
    if (sKey && row.supplier_name && !supplierKey(row.supplier_name).includes(sKey.split(" ")[0] || "")) {
      // still allow match if SKU exact
    }
    for (const sku of skuCandidates) {
      if (identifiersMatch(row.full_sku, sku) || identifiersMatch(row.base_part_number, sku)) {
        return row;
      }
    }
  }
  return null;
}

function findHistoryBySku(
  parsed: ParsedLineDescription,
  history: SupplierClassificationEntry[] | undefined,
  supplier?: string | null,
): SupplierClassificationEntry | null {
  if (!history?.length) return null;
  const sKey = supplierKey(supplier);
  const skuCandidates = [parsed.sku, parsed.partNumber, parsed.basePartNumber].filter(Boolean) as string[];
  for (const h of history) {
    if (h.disabled) continue;
    if (sKey && !supplierKey(h.supplier_name).includes(sKey.split(" ")[0] || "")) continue;
    for (const sku of skuCandidates) {
      if (identifiersMatch(h.part_number, sku) || identifiersMatch(h.model_number, sku)) return h;
      for (const v of normalizeIdentifierVariants(sku)) {
        if (h.normalized_description?.includes(v.toLowerCase())) return h;
      }
    }
  }
  return null;
}

function buildContext(
  supplier: string | null | undefined,
  adjacent: string[] | undefined,
  parsed: ParsedLineDescription,
): LineContextSummary {
  const adjacentProductNouns: string[] = [];
  for (const d of adjacent || []) {
    const p = parseInvoiceLineDescription(d);
    if (p.productNoun) adjacentProductNouns.push(p.productNoun);
  }
  const notes: string[] = [];
  if (adjacentProductNouns.length) {
    notes.push(`Adjacent lines suggest product family context: ${[...new Set(adjacentProductNouns)].join(", ")}`);
  }
  if (parsed.brandOrProductFamily) {
    notes.push(`${parsed.brandOrProductFamily} treated as brand/product family until product type confirmed`);
  }
  return {
    supplierName: supplier || null,
    adjacentProductNouns: [...new Set(adjacentProductNouns)],
    sharedSkuPrefixes: parsed.basePartNumber ? [parsed.basePartNumber.slice(0, 6)] : [],
    invoiceCategoryHints: [],
    notes,
  };
}

function mergeCatalogueIntoParsed(
  parsed: ParsedLineDescription,
  hit: SupplierCatalogueEntry,
): ParsedLineDescription {
  const next = { ...parsed };
  next.productType = hit.product_type || next.productType;
  next.productNoun = hit.product_type || next.productNoun;
  next.material = hit.material || next.material;
  next.function = hit.function_use || next.function;
  next.brandOrProductFamily = hit.brand || next.brandOrProductFamily;
  next.sku = hit.supplier_sku || next.sku;
  next.partNumber = hit.manufacturer_part_number || next.partNumber;
  next.basePartNumber = hit.base_part_number || next.basePartNumber;
  next.catalogueMatchId = hit.id;
  next.resolutionSource = "supplier_catalogue";
  if (hit.product_type) {
    next.identityStatus = hit.material && hit.function_use ? "resolved" : "partial";
    next.identityConfidence = hit.approval_status === "verified" ? 0.92 : 0.7;
  }
  next.missingFields = [];
  if (!next.productType) next.missingFields.push("Actual product type");
  if (!next.material) next.missingFields.push("Material");
  if (!next.function) next.missingFields.push("Primary function/use");
  next.suggestedQuestions = next.suggestedQuestions.filter((q) => {
    if (q.field === "product_type" && next.productType) return false;
    if (q.field === "material" && next.material) return false;
    if ((q.field === "primary_function" || q.field === "function") && next.function) return false;
    return true;
  });
  next.normalizedDescription = [
    next.brandOrProductFamily,
    next.productType,
    next.material,
    hit.product_name,
    next.partNumber,
  ]
    .filter(Boolean)
    .join(" · ");
  return next;
}

function mergeLearningIntoParsed(
  parsed: ParsedLineDescription,
  hit: ProductIdentityLearningEntry,
): ParsedLineDescription {
  const next = { ...parsed };
  next.productType = hit.product_type || next.productType;
  next.productNoun = hit.product_type || next.productNoun;
  next.material = hit.material || next.material;
  next.function = hit.function_use || next.function;
  next.brandOrProductFamily = hit.brand || next.brandOrProductFamily;
  next.resolutionSource = "identity_learning";
  next.identityStatus =
    next.productType && next.material && next.function ? "resolved" : next.productType ? "partial" : "unresolved";
  next.identityConfidence = next.identityStatus === "resolved" ? 0.95 : 0.6;
  next.missingFields = [];
  if (!next.productType) next.missingFields.push("Actual product type");
  if (!next.material) next.missingFields.push("Material");
  if (!next.function) next.missingFields.push("Primary function/use");
  return next;
}

/** Build compact identity key for learning store. */
export function buildProductIdentityKey(parts: {
  supplier?: string | null;
  brand?: string | null;
  basePart?: string | null;
  sku?: string | null;
}): string {
  return [
    supplierKey(parts.supplier) || "-",
    String(parts.brand || "-").toLowerCase(),
    stripIdentifierNoise(parts.basePart || "") || "-",
    stripIdentifierNoise(parts.sku || "") || "-",
  ].join("|");
}

export function resolveProductIdentity(input: IdentityResolverInput): IdentityResolverResult {
  const path = ["line_parse"];
  let parsed = parseInvoiceLineDescription(input.description, {
    supplier: input.supplier,
    abbreviations: input.abbreviations,
    knownBrand: input.knownBrand,
  });

  // Prefer explicit part/model from caller when parser missed
  if (!parsed.partNumber && input.part_number) {
    parsed = {
      ...parsed,
      partNumber: input.part_number,
      basePartNumber: splitSkuVariant(input.part_number).basePartNumber || parsed.basePartNumber,
    };
  }
  if (!parsed.sku && input.model_number) {
    const parts = splitSkuVariant(input.model_number);
    parsed = {
      ...parsed,
      sku: input.model_number,
      normalizedSku: parts.normalizedSku,
      variantSuffix: parts.variantSuffix || parsed.variantSuffix,
    };
  }

  if (input.answers?.length) {
    parsed = applyClerkIdentityAnswers(parsed, input.answers);
    path.push("clerk_answers");
  }

  const context = buildContext(input.supplier, input.adjacentDescriptions, parsed);
  if (context.adjacentProductNouns.length) path.push("adjacent_context");

  // Resolution order
  const learningHit = findLearningMatch(parsed, input.identityLearning, input.supplier);
  if (learningHit) {
    parsed = mergeLearningIntoParsed(parsed, learningHit);
    path.push("identity_learning");
  }

  const catalogueHit = findCatalogueMatch(parsed, input.catalogue, input.supplier);
  if (catalogueHit) {
    parsed = mergeCatalogueIntoParsed(parsed, catalogueHit);
    path.push("supplier_catalogue");
  }

  const historyHit = findHistoryBySku(parsed, input.supplierHistory, input.supplier);
  if (historyHit && parsed.identityStatus === "unresolved") {
    // History can raise confidence for HS later, but does not invent product type from description alone
    path.push("supplier_history_sku");
  }

  // Context may hint family but must not auto-set HS or force product type
  if (
    parsed.identityStatus === "unresolved" &&
    context.adjacentProductNouns.length &&
    !parsed.productType
  ) {
    path.push("context_family_hint");
    // Add a soft note question only — do not auto-assign product type
    const hintQ: ProductQuestion = {
      id: "identity_context_confirm",
      field: "product_type",
      prompt: `Adjacent lines suggest this may be related to: ${context.adjacentProductNouns.join(", ")}. What is this product?`,
      options: [...new Set(context.adjacentProductNouns), "Other", "Unknown"],
      required: true,
    };
    parsed = {
      ...parsed,
      suggestedQuestions: [hintQ, ...parsed.suggestedQuestions.filter((q) => q.field !== "product_type")],
    };
  }

  const blockClassification =
    parsed.identityStatus === "unresolved" ||
    (!parsed.productType && !parsed.productNoun) ||
    parsed.missingFields.includes("Actual product type");

  const verifiedCatalogueHs =
    catalogueHit?.approval_status === "verified" && catalogueHit.approved_hs_code
      ? catalogueHit.approved_hs_code
      : null;
  const learningHs = learningHit?.approved_hs_code || null;

  return {
    parsed,
    context,
    catalogueHit,
    learningHit,
    historyHit,
    blockClassification,
    suggestedHsCode: blockClassification ? null : verifiedCatalogueHs || learningHs,
    dutyRate: blockClassification
      ? null
      : catalogueHit?.duty_rate || learningHit?.duty_rate || null,
    path,
  };
}
