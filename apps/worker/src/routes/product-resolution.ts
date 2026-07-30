import { Hono } from "hono";
import {
  normalizeEvidenceSearch,
  normalizeProductCode,
  parseEvidenceDescription,
} from "@pas/product-intelligence";
import type {
  EvidenceProductResolution,
  EvidenceResolvedProduct,
  ProductEvidenceResult,
  ProductEvidenceSource,
  ProductResolverCandidate,
} from "@pas/shared-types";
import type { Env, AppVariables } from "../env";
import { audit } from "../lib/utils";
import { resolveProduct } from "./product-resolver";

const routes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

type ProductMasterRow = {
  id: number;
  canonical_product_id: number | null;
  canonical_name: string;
  short_name: string | null;
  product_family: string | null;
  industry: string | null;
  primary_function: string | null;
  typical_materials_json: string;
  typical_uses_json: string;
  brands_json: string;
  manufacturers_json: string;
  product_codes_json: string;
  required_attributes_json: string;
  approval_count: number;
  supplier_count: number;
};

type SupplierProductRow = {
  id: number;
  product_master_id: number;
  supplier_name: string;
  product_code: string | null;
  supplier_sku: string | null;
  supplier_description: string | null;
  canonical_product_name: string;
  brand: string | null;
  manufacturer: string | null;
  material: string | null;
  primary_function: string | null;
  product_family: string | null;
  approved_tariff: string | null;
  approval_count: number;
  approved: number;
};

type SupplierCatalogueRow = {
  id: number;
  supplier_name: string;
  brand: string | null;
  supplier_sku: string | null;
  manufacturer_part_number: string | null;
  product_name: string | null;
  product_type: string | null;
  full_description: string | null;
  material: string | null;
  function_use: string | null;
  approved_hs_code: string | null;
  approval_status: string;
  source_document: string | null;
};

function normalizeSupplier(value: string): string {
  return String(value || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function jsonArray(raw: string | null | undefined): string[] {
  try {
    const parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function sourceForCandidate(candidate: ProductResolverCandidate): ProductEvidenceSource {
  if (candidate.source === "supplier_exact") return "supplier_product_code";
  if (candidate.source === "previous_approved") return "previous_approved";
  if (candidate.source === "alias_exact" || candidate.source === "alias_fuzzy") return "alias";
  if (candidate.source === "brand") return "brand_manufacturer";
  if (candidate.source === "token_match") return "similar_import";
  return "product_master";
}

function resolvedFromMaster(
  row: ProductMasterRow,
  parsed: ReturnType<typeof parseEvidenceDescription>,
  candidate?: ProductResolverCandidate,
): EvidenceResolvedProduct {
  const materials = jsonArray(row.typical_materials_json);
  const uses = jsonArray(row.typical_uses_json);
  const brands = jsonArray(row.brands_json);
  const manufacturers = jsonArray(row.manufacturers_json);
  return {
    productMasterId: row.id,
    canonicalName: row.canonical_name,
    displayName: row.short_name || row.canonical_name,
    productFamily: row.product_family || candidate?.productFamily || "",
    industry: row.industry || candidate?.industry || "",
    brand: parsed.possibleBrand || brands[0] || "",
    manufacturer: parsed.possibleManufacturer || manufacturers[0] || "",
    productCode: parsed.possibleProductCode,
    material: parsed.attributes.material || materials[0] || "",
    primaryFunction: row.primary_function || uses[0] || "",
    intendedUse: uses[0] || row.primary_function || "",
  };
}

function resolvedFromSupplier(
  row: SupplierProductRow,
  parsed: ReturnType<typeof parseEvidenceDescription>,
): EvidenceResolvedProduct {
  return {
    productMasterId: row.product_master_id,
    canonicalName: row.canonical_product_name,
    displayName: row.canonical_product_name,
    productFamily: row.product_family || "",
    industry: "",
    brand: row.brand || parsed.possibleBrand,
    manufacturer: row.manufacturer || parsed.possibleManufacturer,
    productCode: row.product_code || row.supplier_sku || parsed.possibleProductCode,
    material: row.material || parsed.attributes.material,
    primaryFunction: row.primary_function || "",
    intendedUse: row.primary_function || "",
  };
}

function missingInformation(product: EvidenceResolvedProduct | null): string[] {
  if (!product) return ["Confirmed product identity"];
  const name = product.canonicalName.toLowerCase();
  const missing: string[] = [];
  if (!product.material) missing.push("Material or composition");
  if (!product.primaryFunction) missing.push("Primary function or intended use");
  if (name.includes("activator")) {
    if (!product.intendedUse) missing.push("Activator use");
    missing.push("Physical form");
    missing.push("SDS availability");
  }
  if (name.includes("shower cap")) missing.push("Disposable or reusable");
  return [...new Set(missing)];
}

function relatedGroup(descriptions: string[]): string | null {
  const joined = descriptions.join(" ").toUpperCase();
  const laggingSignals = ["FLEXLAG", "LAGGING", "FL-ACT", "FL-PRM", "FL-ADH"]
    .filter((signal) => joined.includes(signal)).length;
  if (laggingSignals >= 2) return "Conveyor belt lagging installation materials";
  return null;
}

async function masterRowsForCandidates(
  db: D1Database,
  candidates: ProductResolverCandidate[],
): Promise<Map<number, ProductMasterRow>> {
  const ids = [...new Set(candidates.map((candidate) => candidate.canonicalProductId))];
  if (!ids.length) return new Map();
  const placeholders = ids.map(() => "?").join(",");
  const rows = await db.prepare(
    `SELECT * FROM product_master WHERE canonical_product_id IN (${placeholders}) AND status = 'active'`,
  ).bind(...ids).all<ProductMasterRow>();
  return new Map((rows.results || []).map((row) => [Number(row.canonical_product_id), row]));
}

async function resolveEvidence(
  db: D1Database,
  input: {
    description: string;
    supplier?: string;
    shipmentId?: string;
    nearbyDescriptions?: string[];
  },
): Promise<EvidenceProductResolution> {
  const supplier = normalizeSupplier(input.supplier || "");
  const rawTokens = [...new Set(input.description.toUpperCase().split(/[^A-Z0-9]+/).filter((token) => token.length >= 2))];
  let abbreviationRows: Array<{
    abbreviation: string;
    meaning: string;
    approved: number;
    normalized_supplier: string | null;
    surrounding_terms_json: string;
  }> = [];
  if (rawTokens.length) {
    const placeholders = rawTokens.map(() => "?").join(",");
    const result = await db.prepare(
      `SELECT abbreviation, meaning, approved, normalized_supplier, surrounding_terms_json
       FROM abbreviation_meanings
       WHERE normalized_abbreviation IN (${placeholders})
         AND (normalized_supplier IS NULL OR normalized_supplier = ?)
       ORDER BY approved DESC, usage_count DESC`,
    ).bind(...rawTokens, supplier).all<{
      abbreviation: string;
      meaning: string;
      approved: number;
      normalized_supplier: string | null;
      surrounding_terms_json: string;
    }>();
    abbreviationRows = result.results || [];
  }
  const parsed = parseEvidenceDescription(input.description, {
    abbreviations: abbreviationRows.map((row) => ({
      abbreviation: row.abbreviation,
      meaning: row.meaning,
      approved: row.approved === 1,
      supplier: row.normalized_supplier,
      surroundingTerms: jsonArray(row.surrounding_terms_json),
    })),
  });
  const code = normalizeProductCode(parsed.possibleProductCode || parsed.possibleSku);
  const evidence: ProductEvidenceResult[] = [];
  let exactSupplierProduct: SupplierProductRow | null = null;
  let exactCatalogueProduct: SupplierCatalogueRow | null = null;
  let documentResolvedProduct: EvidenceResolvedProduct | null = null;

  // 1. Exact supplier + product code. This is the strongest resolvable evidence.
  if (supplier && code) {
    exactSupplierProduct = await db.prepare(
      `SELECT * FROM supplier_products
       WHERE approved = 1
         AND (normalized_supplier = ? OR normalized_supplier LIKE ?)
         AND (normalized_product_code = ? OR normalized_sku = ?)
       ORDER BY approval_count DESC, last_approved_at DESC LIMIT 1`,
    ).bind(supplier, `%${supplier}%`, code, code).first<SupplierProductRow>();
    if (exactSupplierProduct) {
      evidence.push({
        source: "supplier_product_code",
        matchedValue: exactSupplierProduct.product_code || exactSupplierProduct.supplier_sku || code,
        productIdentity: exactSupplierProduct.canonical_product_name,
        supplier: exactSupplierProduct.supplier_name,
        productCode: exactSupplierProduct.product_code || "",
        brand: exactSupplierProduct.brand || "",
        manufacturer: exactSupplierProduct.manufacturer || "",
        material: exactSupplierProduct.material || "",
        function: exactSupplierProduct.primary_function || "",
        approvedTariff: exactSupplierProduct.approved_tariff || "",
        confidence: 0.99,
        isApproved: true,
        documentReference: "",
        explanation: `Exact product code for this supplier; approved ${exactSupplierProduct.approval_count} time(s).`,
      });
    }
    exactCatalogueProduct = await db.prepare(
      `SELECT * FROM supplier_product_catalogue
       WHERE status = 'active'
         AND normalized_supplier = ?
         AND (
           replace(replace(replace(upper(COALESCE(normalized_sku, '')), '-', ''), '/', ''), '_', '') = ?
           OR replace(replace(replace(upper(COALESCE(base_part_number, '')), '-', ''), '/', ''), '_', '') = ?
           OR replace(replace(replace(upper(COALESCE(manufacturer_part_number, '')), '-', ''), '/', ''), '_', '') = ?
         )
       ORDER BY CASE approval_status WHEN 'verified' THEN 0 ELSE 1 END, usage_count DESC LIMIT 1`,
    ).bind(supplier, code, code, code).first<SupplierCatalogueRow>();
    if (exactCatalogueProduct && !exactSupplierProduct) {
      const identity =
        exactCatalogueProduct.product_name
        || exactCatalogueProduct.product_type
        || exactCatalogueProduct.full_description
        || "";
      evidence.push({
        source: "supplier_catalogue",
        matchedValue: exactCatalogueProduct.supplier_sku || exactCatalogueProduct.manufacturer_part_number || code,
        productIdentity: identity,
        supplier: exactCatalogueProduct.supplier_name,
        productCode: parsed.possibleProductCode,
        brand: exactCatalogueProduct.brand || parsed.possibleBrand,
        manufacturer: "",
        material: exactCatalogueProduct.material || parsed.attributes.material,
        function: exactCatalogueProduct.function_use || "",
        approvedTariff: exactCatalogueProduct.approved_hs_code || "",
        confidence: exactCatalogueProduct.approval_status === "verified" ? 0.96 : 0.78,
        isApproved: exactCatalogueProduct.approval_status === "verified",
        documentReference: exactCatalogueProduct.source_document || "",
        explanation: "Exact code in the supplier catalogue.",
      });
    }
  }

  // 2. Prior clerk-approved classification history is evidence, but a vague code-only
  // description is still not promoted to a product identity.
  if (supplier) {
    const previous = await db.prepare(
      `SELECT item_description, part_number, model_number, brand, hs_code, tariff_description,
              confidence, usage_count, source_job_id
       FROM supplier_classification_history
       WHERE disabled = 0 AND approved_by_clerk = 1 AND normalized_supplier_name = ?
         AND (
           normalized_description = ?
           OR replace(replace(replace(upper(COALESCE(part_number, '')), '-', ''), '/', ''), '_', '') = ?
           OR replace(replace(replace(upper(COALESCE(model_number, '')), '-', ''), '/', ''), '_', '') = ?
         )
       ORDER BY usage_count DESC, last_used_at DESC LIMIT 1`,
    ).bind(supplier, normalizeSupplier(input.description), code, code).first<{
      item_description: string;
      part_number: string | null;
      model_number: string | null;
      brand: string | null;
      hs_code: string;
      tariff_description: string | null;
      confidence: number;
      usage_count: number;
      source_job_id: string | null;
    }>();
    if (previous) {
      evidence.push({
        source: "previous_approved",
        matchedValue: previous.part_number || previous.model_number || previous.item_description,
        productIdentity: previous.item_description,
        supplier: input.supplier || "",
        productCode: parsed.possibleProductCode,
        brand: previous.brand || parsed.possibleBrand,
        manufacturer: parsed.possibleManufacturer,
        material: parsed.attributes.material,
        function: "",
        approvedTariff: previous.hs_code,
        confidence: Math.max(0.9, Number(previous.confidence || 0)),
        isApproved: true,
        documentReference: previous.source_job_id || "",
        explanation: `Clerk-approved import used ${previous.usage_count} time(s).`,
      });
    }
  }

  // 2-7. Reuse the established approved-history, Product Master, alias, brand and fuzzy index.
  const legacy = await resolveProduct(db, input.description, {
    supplier: input.supplier,
    sku: parsed.possibleProductCode || parsed.possibleSku,
    brand: parsed.possibleBrand,
    limit: 6,
  });
  const masterByCanonical = await masterRowsForCandidates(db, legacy.suggestions);
  for (const candidate of legacy.suggestions) {
    const source = sourceForCandidate(candidate);
    const row = masterByCanonical.get(candidate.canonicalProductId);
    evidence.push({
      source,
      matchedValue: candidate.matchedAlias || parsed.coreDescription || input.description,
      productIdentity: candidate.canonicalName,
      supplier: input.supplier || "",
      productCode: parsed.possibleProductCode,
      brand: parsed.possibleBrand,
      manufacturer: parsed.possibleManufacturer,
      material: parsed.attributes.material || candidate.typicalMaterials[0] || "",
      function: candidate.commonUses[0] || row?.primary_function || "",
      approvedTariff: candidate.approvedTariff || "",
      confidence: candidate.confidence,
      isApproved: source === "previous_approved"
        || source === "supplier_product_code"
        || (source === "product_master" && candidate.source === "product_dictionary" && candidate.confidence >= 0.9)
        || (source === "alias" && candidate.source === "alias_exact"),
      documentReference: "",
      explanation: candidate.reasons.join("; "),
    });
  }

  // Exact Product Master product-code match remains high reliability, but needs clerk confirmation
  // when it has no approved supplier mapping.
  if (code && !exactSupplierProduct) {
    const codeMaster = await db.prepare(
      `SELECT pm.* FROM product_master pm, json_each(pm.product_codes_json) pc
       WHERE pm.status = 'active'
         AND replace(replace(replace(upper(pc.value), '-', ''), '/', ''), '_', '') = ?
       ORDER BY pm.approval_count DESC LIMIT 1`,
    ).bind(code).first<ProductMasterRow>();
    if (codeMaster && !evidence.some((item) =>
      item.source === "product_master" && item.productIdentity === codeMaster.canonical_name)) {
      evidence.push({
        source: "product_master",
        matchedValue: parsed.possibleProductCode,
        productIdentity: codeMaster.canonical_name,
        supplier: input.supplier || "",
        productCode: parsed.possibleProductCode,
        brand: parsed.possibleBrand || jsonArray(codeMaster.brands_json)[0] || "",
        manufacturer: parsed.possibleManufacturer || jsonArray(codeMaster.manufacturers_json)[0] || "",
        material: parsed.attributes.material || jsonArray(codeMaster.typical_materials_json)[0] || "",
        function: codeMaster.primary_function || "",
        approvedTariff: "",
        confidence: 0.94,
        isApproved: codeMaster.approval_count > 0,
        documentReference: "",
        explanation: "Exact product code in Product Master.",
      });
      legacy.suggestions.unshift({
        canonicalProductId: codeMaster.canonical_product_id || -codeMaster.id,
        canonicalName: codeMaster.canonical_name,
        confidence: 0.94,
        source: "product_dictionary",
        matchedAlias: parsed.possibleProductCode,
        industry: codeMaster.industry,
        productFamily: codeMaster.product_family,
        typicalMaterials: jsonArray(codeMaster.typical_materials_json),
        typicalChapters: [],
        commonUses: jsonArray(codeMaster.typical_uses_json),
        typicalAttributes: jsonArray(codeMaster.required_attributes_json),
        approvedTariff: null,
        supplierCount: codeMaster.supplier_count,
        previousImports: 0,
        approvalRate: codeMaster.approval_count > 0 ? 1 : 0,
        reasons: ["Exact Product Master code"],
      });
      masterByCanonical.set(codeMaster.canonical_product_id || -codeMaster.id, codeMaster);
    }
  }

  // 8. Search OCR text from the current shipment only. Internet/external results are never mixed in.
  if (input.shipmentId && (code || parsed.coreDescription)) {
    const searchTerm = code || normalizeEvidenceSearch(parsed.productWords[0] || "");
    if (searchTerm) {
      const references = await db.prepare(
        `SELECT * FROM document_product_references
         WHERE shipment_id = ?
           AND (
             normalized_product_code = ?
             OR upper(COALESCE(extracted_product_name, '')) LIKE ?
             OR upper(COALESCE(excerpt, '')) LIKE ?
           )
         ORDER BY CASE document_type WHEN 'sds' THEN 1 WHEN 'msds' THEN 1
                    WHEN 'product_specification' THEN 2 ELSE 3 END,
                  confidence DESC
         LIMIT 4`,
      ).bind(
        input.shipmentId,
        code,
        `%${searchTerm}%`,
        `%${searchTerm}%`,
      ).all<{
        id: number;
        document_type: string;
        document_filename: string;
        product_code: string | null;
        extracted_product_name: string | null;
        brand: string | null;
        manufacturer: string | null;
        material: string | null;
        primary_function: string | null;
        excerpt: string | null;
        confidence: number;
        approved: number;
      }>();
      for (const reference of references.results || []) {
        const identity = reference.extracted_product_name || "";
        evidence.push({
          source: "attached_document",
          matchedValue: reference.product_code || searchTerm,
          productIdentity: identity,
          supplier: input.supplier || "",
          productCode: reference.product_code || parsed.possibleProductCode,
          brand: reference.brand || parsed.possibleBrand,
          manufacturer: reference.manufacturer || parsed.possibleManufacturer,
          material: reference.material || parsed.attributes.material,
          function: reference.primary_function || "",
          approvedTariff: "",
          confidence: Math.min(0.9, Math.max(0.7, Number(reference.confidence || 0.8))),
          isApproved: reference.approved === 1,
          documentReference: `${reference.document_type}: ${reference.document_filename}`,
          explanation: reference.excerpt || "Supporting shipment document product reference.",
        });
        if (!documentResolvedProduct && identity) {
          documentResolvedProduct = {
            productMasterId: null,
            canonicalName: identity,
            displayName: identity,
            productFamily: "",
            industry: "",
            brand: reference.brand || parsed.possibleBrand,
            manufacturer: reference.manufacturer || parsed.possibleManufacturer,
            productCode: reference.product_code || parsed.possibleProductCode,
            material: reference.material || parsed.attributes.material,
            primaryFunction: reference.primary_function || "",
            intendedUse: reference.primary_function || "",
          };
        }
      }
      const docs = await db.prepare(
        `SELECT dp.page_number, dp.cleaned_text, dp.raw_ocr_text,
                dj.original_filename, dj.document_id, dj.document_type
         FROM document_pages dp
         JOIN document_processing_jobs dj ON dj.id = dp.job_id
         WHERE (dp.job_id = ? OR dj.document_id = ? OR dj.shipment_id = ?)
           AND upper(COALESCE(dp.cleaned_text, dp.raw_ocr_text, '')) LIKE ?
         ORDER BY dp.page_number LIMIT 4`,
      ).bind(input.shipmentId, input.shipmentId, input.shipmentId, `%${searchTerm}%`).all<{
        page_number: number;
        cleaned_text: string | null;
        raw_ocr_text: string | null;
        original_filename: string;
        document_id: string;
        document_type: string;
      }>();
      for (const doc of docs.results || []) {
        const text = doc.cleaned_text || doc.raw_ocr_text || "";
        const index = text.toUpperCase().indexOf(searchTerm);
        const excerpt = text.slice(Math.max(0, index - 100), index + searchTerm.length + 180).replace(/\s+/g, " ");
        evidence.push({
          source: "attached_document",
          matchedValue: searchTerm,
          productIdentity: exactSupplierProduct?.canonical_product_name || legacy.suggestions[0]?.canonicalName || "",
          supplier: input.supplier || "",
          productCode: parsed.possibleProductCode,
          brand: parsed.possibleBrand,
          manufacturer: parsed.possibleManufacturer,
          material: parsed.attributes.material,
          function: "",
          approvedTariff: "",
          confidence: 0.86,
          isApproved: false,
          documentReference: `${doc.document_type}: ${doc.original_filename}, page ${doc.page_number}`,
          explanation: excerpt,
        });
      }
    }
  }

  evidence.sort((a, b) => {
    const priority: Record<ProductEvidenceSource, number> = {
      supplier_product_code: 1,
      previous_approved: 2,
      product_master: 3,
      supplier_catalogue: 4,
      alias: 5,
      brand_manufacturer: 6,
      similar_import: 7,
      attached_document: 8,
      ai_interpretation: 9,
      external_lookup: 10,
    };
    return priority[a.source] - priority[b.source] || b.confidence - a.confidence;
  });

  const candidates = legacy.suggestions
    .filter((candidate, index, all) =>
      all.findIndex((other) => other.canonicalName === candidate.canonicalName) === index)
    .slice(0, 3);
  const top = candidates[0] || null;
  const topMaster = top ? masterByCanonical.get(top.canonicalProductId) : null;
  let resolvedProduct = exactSupplierProduct
    ? resolvedFromSupplier(exactSupplierProduct, parsed)
    : exactCatalogueProduct
      ? {
          productMasterId: null,
          canonicalName:
            exactCatalogueProduct.product_name
            || exactCatalogueProduct.product_type
            || exactCatalogueProduct.full_description
            || "",
          displayName:
            exactCatalogueProduct.product_name
            || exactCatalogueProduct.product_type
            || exactCatalogueProduct.full_description
            || "",
          productFamily: exactCatalogueProduct.product_type || "",
          industry: "",
          brand: exactCatalogueProduct.brand || parsed.possibleBrand,
          manufacturer: parsed.possibleManufacturer,
          productCode: exactCatalogueProduct.supplier_sku || parsed.possibleProductCode,
          material: exactCatalogueProduct.material || parsed.attributes.material,
          primaryFunction: exactCatalogueProduct.function_use || "",
          intendedUse: exactCatalogueProduct.function_use || "",
        }
    : documentResolvedProduct
      ? documentResolvedProduct
    : top && topMaster
      ? resolvedFromMaster(topMaster, parsed, top)
      : null;

  const strongTopSource = top && ["supplier_exact", "previous_approved", "alias_exact", "product_dictionary"]
    .includes(top.source);
  const hasApprovedExact = evidence.some((item) =>
    item.isApproved && ["supplier_product_code", "previous_approved", "product_master", "alias"].includes(item.source));
  let status: EvidenceProductResolution["status"] = "unresolved";
  let confidence = exactSupplierProduct ? 0.99 : top?.confidence || 0;
  if (
    exactSupplierProduct
    || (exactCatalogueProduct?.approval_status === "verified")
    || (top && strongTopSource && top.confidence >= 0.88 && hasApprovedExact)
  ) {
    status = "resolved";
    if (exactCatalogueProduct && !exactSupplierProduct) {
      confidence = exactCatalogueProduct.approval_status === "verified" ? 0.96 : 0.78;
    }
  } else if (top && top.confidence >= 0.4) {
    status = "possible_matches";
  } else if (documentResolvedProduct) {
    status = "possible_matches";
    confidence = Math.max(confidence, 0.86);
  } else {
    resolvedProduct = null;
    confidence = Math.min(confidence, 0.35);
  }

  return {
    status,
    rawDescription: input.description,
    parsed,
    resolvedProduct,
    evidence,
    confidence: Math.round(confidence * 1000) / 1000,
    missingInformation: missingInformation(resolvedProduct),
    possibleMatches: candidates.map((candidate) => {
      const row = masterByCanonical.get(candidate.canonicalProductId);
      const product = row
        ? resolvedFromMaster(row, parsed, candidate)
        : {
            productMasterId: null,
            canonicalName: candidate.canonicalName,
            displayName: candidate.canonicalName,
            productFamily: candidate.productFamily || "",
            industry: candidate.industry || "",
            brand: parsed.possibleBrand,
            manufacturer: parsed.possibleManufacturer,
            productCode: parsed.possibleProductCode,
            material: parsed.attributes.material || candidate.typicalMaterials[0] || "",
            primaryFunction: candidate.commonUses[0] || "",
            intendedUse: candidate.commonUses[0] || "",
          };
      return {
        product,
        confidence: candidate.confidence,
        evidenceSummary: candidate.reasons.join("; "),
      };
    }),
    relatedProductGroup: relatedGroup([input.description, ...(input.nearbyDescriptions || [])]),
  };
}

async function persistResolution(
  db: D1Database,
  lineId: string,
  shipmentId: string | undefined,
  supplier: string | undefined,
  resolution: EvidenceProductResolution,
): Promise<number | null> {
  const inserted = await db.prepare(
    `INSERT INTO product_resolution_results
      (invoice_line_id, shipment_id, supplier_name, raw_description, parsed_json, status,
       resolved_product_json, confidence, missing_information_json, possible_matches_json,
       related_product_group)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    lineId,
    shipmentId || null,
    supplier || null,
    resolution.rawDescription,
    JSON.stringify(resolution.parsed),
    resolution.status,
    resolution.resolvedProduct ? JSON.stringify(resolution.resolvedProduct) : null,
    resolution.confidence,
    JSON.stringify(resolution.missingInformation),
    JSON.stringify(resolution.possibleMatches),
    resolution.relatedProductGroup || null,
  ).run();
  const resolutionId = Number((inserted.meta as { last_row_id?: number }).last_row_id || 0) || null;
  for (const item of resolution.evidence) {
    const result = await db.prepare(
      `INSERT INTO product_evidence
        (invoice_line_id, shipment_id, resolution_id, product_master_id, source, matched_value,
         product_identity, supplier, product_code, brand, manufacturer, material,
         primary_function, approved_tariff, confidence, is_approved, document_reference, evidence_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      lineId,
      shipmentId || null,
      resolutionId,
      resolution.resolvedProduct?.productMasterId || null,
      item.source,
      item.matchedValue,
      item.productIdentity,
      item.supplier,
      item.productCode,
      item.brand,
      item.manufacturer,
      item.material,
      item.function,
      item.approvedTariff,
      item.confidence,
      item.isApproved ? 1 : 0,
      item.documentReference,
      JSON.stringify(item),
    ).run();
    item.id = Number((result.meta as { last_row_id?: number }).last_row_id || 0) || undefined;
  }
  return resolutionId;
}

routes.post("/resolve", async (c) => {
  const body = await c.req.json<{
    invoiceLineId: string | number;
    description: string;
    supplierId?: string;
    supplierName?: string;
    shipmentId?: string;
    nearbyDescriptions?: string[];
  }>();
  if (!String(body.description || "").trim()) {
    return c.json({ success: false, error: "description is required" }, 400);
  }
  const supplier = body.supplierName || body.supplierId || "";
  const resolution = await resolveEvidence(c.env.DB, {
    description: body.description,
    supplier,
    shipmentId: body.shipmentId,
    nearbyDescriptions: body.nearbyDescriptions,
  });
  const resolutionId = await persistResolution(
    c.env.DB,
    String(body.invoiceLineId),
    body.shipmentId,
    supplier,
    resolution,
  );
  await audit(c, "evidence_product_resolve");
  return c.json({ ...resolution, resolutionId });
});

routes.post("/confirm", async (c) => {
  const body = await c.req.json<{
    invoiceLineId: string | number;
    resolutionId?: number;
    productMasterId?: number | null;
    resolvedProduct: EvidenceResolvedProduct;
    rawDescription?: string;
    parsedProductCode?: string;
    supplierId?: string;
    supplierName?: string;
    createAlias?: boolean;
    evidenceIds?: number[];
    previousProduct?: EvidenceResolvedProduct | null;
  }>();
  if (!body.resolvedProduct?.canonicalName) {
    return c.json({ success: false, error: "resolvedProduct.canonicalName is required" }, 400);
  }

  const supplierName = body.supplierName || body.supplierId || "";
  const normalizedName = normalizeSupplier(body.resolvedProduct.canonicalName);
  let master = body.productMasterId
    ? await c.env.DB.prepare(`SELECT * FROM product_master WHERE id = ?`).bind(body.productMasterId)
      .first<ProductMasterRow>()
    : await c.env.DB.prepare(`SELECT * FROM product_master WHERE normalized_name = ?`)
      .bind(normalizedName).first<ProductMasterRow>();

  if (!master) {
    const inserted = await c.env.DB.prepare(
      `INSERT INTO product_master
        (canonical_name, normalized_name, short_name, product_family, industry, primary_function,
         typical_materials_json, typical_uses_json, brands_json, manufacturers_json,
         product_codes_json, created_from, approval_count, last_approved_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'clerk_confirmation', 1, datetime('now'))`,
    ).bind(
      body.resolvedProduct.canonicalName,
      normalizedName,
      body.resolvedProduct.displayName || body.resolvedProduct.canonicalName,
      body.resolvedProduct.productFamily || null,
      body.resolvedProduct.industry || null,
      body.resolvedProduct.primaryFunction || body.resolvedProduct.intendedUse || null,
      JSON.stringify(body.resolvedProduct.material ? [body.resolvedProduct.material] : []),
      JSON.stringify(body.resolvedProduct.intendedUse ? [body.resolvedProduct.intendedUse] : []),
      JSON.stringify(body.resolvedProduct.brand ? [body.resolvedProduct.brand] : []),
      JSON.stringify(body.resolvedProduct.manufacturer ? [body.resolvedProduct.manufacturer] : []),
      JSON.stringify(body.resolvedProduct.productCode ? [body.resolvedProduct.productCode] : []),
    ).run();
    const id = Number((inserted.meta as { last_row_id?: number }).last_row_id || 0);
    master = await c.env.DB.prepare(`SELECT * FROM product_master WHERE id = ?`).bind(id).first<ProductMasterRow>();
  } else {
    await c.env.DB.prepare(
      `UPDATE product_master SET approval_count = approval_count + 1,
       last_approved_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`,
    ).bind(master.id).run();
  }
  if (!master) return c.json({ success: false, error: "Unable to save Product Master record" }, 500);

  if (body.resolutionId) {
    await c.env.DB.prepare(
      `UPDATE product_resolution_results SET confirmed = 1, confirmed_by = ?,
       confirmed_at = datetime('now'), status = 'resolved', resolved_product_json = ?,
       updated_at = datetime('now') WHERE id = ?`,
    ).bind(c.var.username, JSON.stringify(body.resolvedProduct), body.resolutionId).run();
  }

  const code = normalizeProductCode(body.parsedProductCode || body.resolvedProduct.productCode);
  const normalizedSupplier = normalizeSupplier(supplierName);
  if (supplierName && code) {
    await c.env.DB.prepare(
      `INSERT INTO supplier_products
        (supplier_id, supplier_name, normalized_supplier, product_code, normalized_product_code,
         supplier_sku, normalized_sku, supplier_description, normalized_description,
         product_master_id, canonical_product_name, brand, manufacturer, material,
         primary_function, product_family, original_descriptions_json, clerk_aliases_json,
         approved, approval_count, last_approved_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, datetime('now'))
       ON CONFLICT DO UPDATE SET
         product_master_id = excluded.product_master_id,
         canonical_product_name = excluded.canonical_product_name,
         brand = excluded.brand,
         manufacturer = excluded.manufacturer,
         material = excluded.material,
         primary_function = excluded.primary_function,
         product_family = excluded.product_family,
         approval_count = supplier_products.approval_count + 1,
         original_descriptions_json = json_insert(
           supplier_products.original_descriptions_json, '$[#]', excluded.supplier_description),
         approved = 1, last_approved_at = datetime('now'), updated_at = datetime('now')`,
    ).bind(
      body.supplierId || null,
      supplierName,
      normalizedSupplier,
      body.parsedProductCode || body.resolvedProduct.productCode,
      code,
      body.parsedProductCode || body.resolvedProduct.productCode,
      code,
      body.rawDescription || "",
      normalizeSupplier(body.rawDescription || ""),
      master.id,
      body.resolvedProduct.canonicalName,
      body.resolvedProduct.brand || null,
      body.resolvedProduct.manufacturer || null,
      body.resolvedProduct.material || null,
      body.resolvedProduct.primaryFunction || body.resolvedProduct.intendedUse || null,
      body.resolvedProduct.productFamily || null,
      JSON.stringify(body.rawDescription ? [body.rawDescription] : []),
      JSON.stringify(body.rawDescription ? [body.rawDescription] : []),
    ).run();
  }

  // Existing cross-supplier Product Master records are not rewritten by a correction.
  const supplierCountRow = await c.env.DB.prepare(
    `SELECT COUNT(DISTINCT normalized_supplier) AS supplier_count
     FROM supplier_products WHERE product_master_id = ? AND approved = 1`,
  ).bind(master.id).first<{ supplier_count: number }>();
  const supplierCount = Number(supplierCountRow?.supplier_count || master.supplier_count || 0);
  await c.env.DB.prepare(
    `UPDATE product_master SET supplier_count = ?, updated_at = datetime('now') WHERE id = ?`,
  ).bind(supplierCount, master.id).run();
  const requiresSupervisorReview = Boolean(
    body.previousProduct
    && body.previousProduct.canonicalName !== body.resolvedProduct.canonicalName
    && supplierCount > 1,
  );
  if (body.createAlias && body.rawDescription && master.canonical_product_id) {
    const alias = normalizeSupplier(body.rawDescription);
    await c.env.DB.prepare(
      `INSERT OR IGNORE INTO product_aliases
        (canonical_product_id, product_master_id, alias, normalized_alias, compact_alias,
         source, supplier_name, supplier_id, approved, usage_count, created_by)
       VALUES (?, ?, ?, ?, ?, 'clerk_confirmation', ?, ?, 1, 1, ?)`,
    ).bind(
      master.canonical_product_id,
      master.id,
      body.rawDescription,
      alias,
      alias.replace(/\s+/g, ""),
      supplierName || null,
      body.supplierId || null,
      c.var.username,
    ).run();
  }

  await c.env.DB.prepare(
    `INSERT INTO product_resolver_events
      (event_type, original_description, normalized_query, supplier_name, canonical_product_id,
       selected_name, confidence, source, metadata_json, clerk_username)
     VALUES (?, ?, ?, ?, ?, ?, 1, 'manual', ?, ?)`,
  ).bind(
    requiresSupervisorReview ? "product_correction_supervisor_review" : "product_confirmed",
    body.rawDescription || "",
    normalizeSupplier(body.rawDescription || ""),
    supplierName || null,
    master.canonical_product_id,
    body.resolvedProduct.canonicalName,
    JSON.stringify({
      productMasterId: master.id,
      previousProduct: body.previousProduct || null,
      correctedProduct: body.resolvedProduct,
      evidenceIds: body.evidenceIds || [],
      requiresSupervisorReview,
    }),
    c.var.username,
  ).run();
  await audit(c, "evidence_product_confirm");
  return c.json({
    success: true,
    productMasterId: master.id,
    requiresSupervisorReview,
    status: requiresSupervisorReview ? "Needs Review" : "Product Resolved",
  });
});

routes.post("/external-lookup", async (c) => {
  const body = await c.req.json<{ invoiceLineId: string | number; query: string }>();
  if (c.env.PRODUCT_LOOKUP_URL) {
    const response = await fetch(c.env.PRODUCT_LOOKUP_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(c.env.PRODUCT_LOOKUP_TOKEN
          ? { Authorization: `Bearer ${c.env.PRODUCT_LOOKUP_TOKEN}` }
          : {}),
      },
      body: JSON.stringify({ query: body.query, limit: 5 }),
    });
    if (!response.ok) {
      return c.json({
        status: "clerk_action_required",
        label: "External Product Information — Clerk Review Required",
        query: body.query,
        results: [],
        message: `External lookup provider returned ${response.status}. Internal evidence was not modified.`,
      });
    }
    const payload = await response.json<{
      results?: Array<{
        title?: string;
        source?: string;
        description?: string;
        manufacturer?: string;
        use?: string;
        material?: string;
      }>;
    }>();
    const results = (payload.results || []).slice(0, 5).map((result) => ({
      title: String(result.title || ""),
      source: String(result.source || ""),
      extractedProductDescription: String(result.description || ""),
      manufacturer: String(result.manufacturer || ""),
      productUse: String(result.use || ""),
      materialOrComposition: String(result.material || ""),
      lookupDate: new Date().toISOString(),
      approved: false,
    }));
    for (const result of results) {
      await c.env.DB.prepare(
        `INSERT INTO product_evidence
          (invoice_line_id, source, matched_value, product_identity, manufacturer,
           material, primary_function, confidence, is_approved, document_reference, evidence_json)
         VALUES (?, 'external_lookup', ?, ?, ?, ?, ?, 0.35, 0, ?, ?)`,
      ).bind(
        String(body.invoiceLineId),
        body.query,
        result.extractedProductDescription || result.title,
        result.manufacturer,
        result.materialOrComposition,
        result.productUse,
        result.source,
        JSON.stringify(result),
      ).run();
    }
    await audit(c, "external_product_lookup");
    return c.json({
      status: "clerk_action_required",
      label: "External Product Information — Clerk Review Required",
      query: body.query,
      results,
      message: "Public results are unapproved and cannot confirm a product or tariff.",
    });
  }
  return c.json({
    status: "clerk_action_required",
    label: "External Product Information — Clerk Review Required",
    query: body.query,
    results: [],
    message: "No external search provider is configured. Internal approved evidence was not modified.",
  });
});

export default routes;
