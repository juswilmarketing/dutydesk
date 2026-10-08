import type {
  BatchClassifyRequest,
  BatchClassifyResponse,
  BrandDictionaryEntry,
  ChapterPredictionRuleEntry,
  ClassifyResult,
  Consignee,
  DutyDeskJobType,
  ExchangeRate,
  IndustryDictionaryEntry,
  LearnedEntry,
  ParsedInvoiceResult,
  ProductDictionaryEntry,
  ProductIntelligenceAnalyzeResult,
  ProductResolution,
  ProductResolverCandidate,
  ProductProfile,
  ProductPrediction,
  ProductQuestion,
  ProductQuestionAnswer,
  ClassificationExplainability,
  ClassificationRecommendationCandidate,
  ClassificationRecommendationResponse,
  EvidenceProductResolution,
  EvidenceResolvedProduct,
  QuestionRuleEntry,
  SessionUser,
  SupplierCatalogueEntry,
  AbbreviationDictionaryEntry,
  SupplierClassificationEntry,
  TariffEntry,
  TaxLogEntry,
  TeamUser,
} from "@pas/shared-types";
import type { JobState } from "@/lib/job-state";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Default for auth / CRUD — short enough to surface hangs, long enough for worker cold starts. */
const DEFAULT_TIMEOUT_MS = 60_000;
/** AI classify / invoice parse / FlowBoard PDF handoff often take longer. */
const LONG_TIMEOUT_MS = 180_000;

function isAbortError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "name" in err &&
    (err as { name: string }).name === "AbortError"
  );
}

function friendlyHttpError(status: number, rawBody: string): string {
  if (status === 524 || status === 504 || status === 502 || status === 503) {
    return "Document processing took longer than expected. Your file has been saved and processing will continue in the background.";
  }
  if (/error code:\s*524/i.test(rawBody) || /A Timeout Occurred/i.test(rawBody)) {
    return "Document processing took longer than expected. Your file has been saved and processing will continue in the background.";
  }
  return rawBody.slice(0, 500) || `Request failed (${status})`;
}

/** Safe JSON fetch — never throws raw Cloudflare HTML/text into the UI as a JSON parse error. */
export async function safeFetchJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  const contentType = response.headers.get("content-type") || "";
  const rawBody = await response.text();

  if (!response.ok) {
    let message = friendlyHttpError(response.status, rawBody);
    let code: string | undefined;
    if (contentType.includes("application/json") && rawBody) {
      try {
        const parsed = JSON.parse(rawBody) as {
          error?: string | { message?: string };
          message?: string;
          code?: unknown;
        };
        if (typeof parsed.error === "string") message = parsed.error;
        else if (parsed.error && typeof parsed.error === "object" && parsed.error.message) {
          message = parsed.error.message;
        } else if (parsed.message) message = parsed.message;
        if (typeof parsed.code === "string") code = parsed.code;
      } catch {
        /* keep friendly message */
      }
    }
    throw new ApiError(`Request failed (${response.status}): ${message.slice(0, 500)}`, response.status, code);
  }

  if (!rawBody) return {} as T;

  if (contentType.includes("application/x-ndjson")) {
    throw new ApiError("Expected JSON but received a stream response", 500);
  }

  if (contentType && !contentType.includes("application/json") && !contentType.includes("text/plain")) {
    throw new ApiError(
      `Expected JSON but received ${contentType || "unknown content type"}`,
      response.status,
    );
  }

  try {
    return JSON.parse(rawBody) as T;
  } catch {
    throw new ApiError(
      friendlyHttpError(response.status || 500, rawBody) || "Server returned invalid JSON.",
      response.status || 500,
    );
  }
}

async function request<T>(
  path: string,
  init?: RequestInit,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onCallerAbort = () => controller.abort();
  init?.signal?.addEventListener("abort", onCallerAbort);

  try {
    const headers = new Headers(init?.headers);
    if (!headers.has("Content-Type") && init?.body) {
      headers.set("Content-Type", "application/json");
    }
    return await safeFetchJson<T>(path, {
      ...init,
      credentials: init?.credentials ?? "include",
      headers,
      signal: controller.signal,
    });
  } catch (err) {
    if (isAbortError(err)) {
      if (init?.signal?.aborted) throw err;
      throw new ApiError(
        `Request timed out after ${Math.round(timeoutMs / 1000)}s. The server may still be processing — wait a moment and try again.`,
        408,
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
    init?.signal?.removeEventListener("abort", onCallerAbort);
  }
}

export type DocumentProcessingJobStatus = {
  success: boolean;
  jobId: string;
  documentId?: string;
  status: string;
  currentStage?: string | null;
  pagesTotal: number;
  pagesCompleted: number;
  progressPercent: number;
  batchSize?: number;
  currentBatch?: number;
  retryCount?: number;
  warnings?: string[];
  error?: { code?: string | null; message?: string } | null;
  invoices?: ParsedInvoiceResult["invoices"] | null;
  lineItemsExtracted?: number;
  originalFilename?: string;
  message?: string;
};

async function runDocumentJobToCompletion(
  jobId: string,
  onProgress?: (job: DocumentProcessingJobStatus) => void,
  allowEmptyInvoices = false,
): Promise<ParsedInvoiceResult> {
  const deadline = Date.now() + 30 * 60_000;
  let last: DocumentProcessingJobStatus | null = null;

  while (Date.now() < deadline) {
    last = await request<DocumentProcessingJobStatus>(
      `/api/document-processing/jobs/${encodeURIComponent(jobId)}/advance`,
      { method: "POST", body: "{}" },
      120_000,
    );
    onProgress?.(last);

    if (last.status === "completed" || last.status === "completed_with_warnings") {
      if (!allowEmptyInvoices && !last.invoices?.length) {
        throw new ApiError("No line items found in this file.", 422);
      }
      return { invoices: last.invoices || [] };
    }
    if (last.status === "failed" || last.status === "cancelled") {
      throw new ApiError(
        last.error?.message ||
          "Processing stopped. Pages already completed were preserved — use Retry to continue.",
        500,
      );
    }

    // Brief pause between batches so UI can update
    await new Promise((r) => setTimeout(r, 400));
  }

  throw new ApiError(
    "Document processing took longer than expected. Your file has been saved — open the job again or retry.",
    408,
  );
}

export const api = {
  login: (username: string, password: string) =>
    request<SessionUser>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),

  logout: () => request<{ ok: boolean }>("/api/auth/logout", { method: "POST" }),

  me: () => request<SessionUser>("/api/auth/me"),

  searchTariff: (q: string, limit = 8) =>
    request<{ results: TariffEntry[] }>(`/api/tariff/search?q=${encodeURIComponent(q)}&limit=${limit}`),

  classify: (description: string) =>
    request<ClassifyResult>(
      "/api/classify",
      {
        method: "POST",
        body: JSON.stringify({ description }),
      },
      LONG_TIMEOUT_MS,
    ),

  classifyBatch: (payload: BatchClassifyRequest) =>
    request<BatchClassifyResponse>(
      "/api/classify/batch",
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
      LONG_TIMEOUT_MS,
    ),

  registerClassificationLines: (payload: {
    invoiceId: string;
    lines: Array<{
      lineId: number;
      originalDescription: string;
      quantity: number;
      unitPrice: number;
      productProfile?: ProductProfile;
    }>;
    taxInputs: import("@pas/shared-types").TaxInputs;
    exchangeRate: number;
    itemExemptions: Record<number, import("@pas/shared-types").ItemExemptions>;
  }) =>
    request<{ success: true; registered: number }>("/api/classification-lines/register-batch", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  generateLineRecommendation: (
    lineId: number,
    payload: {
      invoiceId: string;
      originalDescription: string;
      quantity?: number;
      unitPrice?: number;
      productProfile?: ProductProfile;
      predictedChapter?: string | null;
      headingCandidates?: import("@pas/shared-types").HeadingCandidate[];
      resolutionId?: number;
      evidenceIds?: number[];
      productMasterId?: number | null;
      clarificationAnswer?: { id: string; value: string } | null;
      consignee?: string | null;
      invoiceNotes?: string | null;
      forceSupplierSearch?: boolean;
      applySupplierEvidence?: boolean;
    },
  ) =>
    request<ClassificationRecommendationResponse>(
      `/api/classification-lines/${lineId}/recommendation`,
      { method: "POST", body: JSON.stringify(payload) },
      LONG_TIMEOUT_MS,
    ),

  searchSupplierProduct: (payload: {
    supplier?: string;
    sku?: string;
    description: string;
    forceSearch?: boolean;
    allowExternal?: boolean;
  }) =>
    request<{
      status: string;
      searched: boolean;
      evidence: import("@pas/shared-types").SupplierProductEvidence | null;
      notification?: string;
      queries: string[];
    }>("/api/supplier-search/search", {
      method: "POST",
      body: JSON.stringify(payload),
    }, LONG_TIMEOUT_MS),

  approveSupplierEvidence: (payload: {
    supplier: string;
    sku?: string;
    rawDescription: string;
    canonicalProduct: string;
    material?: string;
    primaryFunction?: string;
    intendedUse?: string;
    technicalSpecifications?: Record<string, string | number | boolean | null>;
    approvedTariff?: string;
    sourceUrl?: string;
    sourceType?: string;
    emptyOrFilled?: string;
    excerpt?: string;
  }) =>
    request<{ success: true }>("/api/supplier-search/approve", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  applyLineRecommendation: (
    lineId: number,
    payload: {
      candidate: ClassificationRecommendationCandidate;
      source: "ai_recommendation" | "clerk_edited_ai_recommendation";
      resolutionId?: number;
      evidenceIds?: number[];
      productMasterId?: number | null;
    },
  ) =>
    request<{
      success: true;
      line: Record<string, unknown>;
      candidate: ClassificationRecommendationCandidate;
      worksheetTotals: {
        goodsValue: number;
        cifUSD?: number;
        cifTTD?: number;
        duty: number;
        vat: number;
        levy: number;
        containerFee?: number;
        userFee?: number;
        totalTaxes: number;
      };
    }>(`/api/classification-lines/${lineId}/apply-recommendation`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  resolveProduct: (payload: {
    description: string;
    supplier?: string | null;
    sku?: string | null;
    brand?: string | null;
    limit?: number;
  }) =>
    request<{ success: true; resolution: ProductResolution }>("/api/product-resolver/resolve", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  resolveProductsBatch: (payload: {
    supplier?: string | null;
    items: Array<{
      lineId: number;
      description: string;
      sku?: string | null;
      brand?: string | null;
    }>;
  }) =>
    request<{ success: true; results: Array<{ lineId: number; resolution: ProductResolution }> }>(
      "/api/product-resolver/resolve/batch",
      { method: "POST", body: JSON.stringify(payload) },
    ),

  searchProducts: (query: string, supplier?: string | null, brand?: string | null) => {
    const params = new URLSearchParams({ q: query });
    if (supplier) params.set("supplier", supplier);
    if (brand) params.set("brand", brand);
    return request<{ success: true; results: ProductResolverCandidate[] }>(
      `/api/product-resolver/search?${params.toString()}`,
    );
  },

  confirmProductResolution: (payload: {
    canonicalProductId?: number;
    previousProductId?: number | null;
    canonicalName?: string;
    originalDescription: string;
    supplier?: string | null;
    sku?: string | null;
    brand?: string | null;
    productFamily?: string | null;
    industryCode?: string | null;
    typicalMaterials?: string[];
    typicalChapters?: string[];
    commonUses?: string[];
    typicalAttributes?: string[];
    approvedTariff?: string | null;
    classificationApproval?: boolean;
    answers?: Array<{ field: string; value: string }>;
  }) =>
    request<{ success: true; canonicalProductId: number; aliasAdded: string }>(
      "/api/product-resolver/confirm",
      { method: "POST", body: JSON.stringify(payload) },
    ),

  resolveProductEvidence: (payload: {
    invoiceLineId: string | number;
    description: string;
    supplierId?: string;
    supplierName?: string;
    shipmentId?: string;
    nearbyDescriptions?: string[];
  }) =>
    request<EvidenceProductResolution & { resolutionId?: number }>("/api/product-resolution/resolve", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  confirmEvidenceProduct: (payload: {
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
  }) =>
    request<{
      success: true;
      productMasterId: number;
      requiresSupervisorReview: boolean;
      status: "Product Resolved" | "Needs Review";
    }>("/api/product-resolution/confirm", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  externalProductLookup: (payload: { invoiceLineId: string | number; query: string }) =>
    request<{
      status: "clerk_action_required";
      label: string;
      query: string;
      results: unknown[];
      message: string;
    }>("/api/product-resolution/external-lookup", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  logProductResolverEvent: (payload: {
    eventType: string;
    originalDescription?: string;
    canonicalProductId?: number | null;
    selectedName?: string | null;
    confidence?: number | null;
    source?: string | null;
    metadata?: Record<string, unknown>;
  }) =>
    request<{ success: true }>("/api/product-resolver/events", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  getProductResolverAnalytics: () =>
    request<{
      success: true;
      topProducts: Array<{ id: number; canonical_name: string; import_count: number; approval_count: number }>;
      mostCorrected: Array<{ id: number; canonical_name: string; correction_count: number }>;
      unknownProducts: Array<{ name: string; count: number }>;
      commonAliases: Array<{ alias: string; usage_count: number }>;
      supplierCatalogueGrowth: Array<{ supplier_name: string; products: number; imports: number }>;
      productsLearnedToday: number;
    }>("/api/product-resolver/analytics"),

  analyzeProductIntelligence: (payload: {
    supplier_name?: string;
    supplier_history?: SupplierClassificationEntry[];
    items: Array<{
      line_id: number;
      description: string;
      part_number?: string;
      model_number?: string;
      answers?: ProductQuestionAnswer[];
    }>;
  }) =>
    request<{ results: ProductIntelligenceAnalyzeResult[] }>(
      "/api/product-intelligence/analyze",
      { method: "POST", body: JSON.stringify(payload) },
      LONG_TIMEOUT_MS,
    ),

  reanalyzeProductIntelligence: (payload: {
    supplier_name?: string;
    supplier_history?: SupplierClassificationEntry[];
    line_id: number;
    description: string;
    part_number?: string;
    model_number?: string;
    answers?: ProductQuestionAnswer[];
  }) =>
    request<{ result: ProductIntelligenceAnalyzeResult }>(
      "/api/product-intelligence/reanalyze",
      { method: "POST", body: JSON.stringify(payload) },
      LONG_TIMEOUT_MS,
    ),

  learnProductIntelligence: (payload: {
    original_description: string;
    profile: ProductProfile | unknown;
    predictions?: ProductPrediction | unknown;
    questions?: ProductQuestion[] | unknown;
    answers?: ProductQuestionAnswer[] | unknown;
    explainability?: ClassificationExplainability | unknown;
    selected_hs_code: string;
    duty_rate?: string;
    supplier_name?: string;
    brand?: string;
    invoice_id?: string;
    liquid_profile?: import("@pas/shared-types").LiquidProductProfile;
  }) =>
    request<{ ok: boolean; profile_id?: number }>("/api/product-intelligence/learn", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  getAbbreviations: () =>
    request<{ entries: AbbreviationDictionaryEntry[] }>("/api/product-intelligence/abbreviations"),
  saveAbbreviation: (payload: {
    abbreviation: string;
    meaning: string;
    scope?: string;
    industry_code?: string;
    supplier_name?: string;
    confidence?: number;
    verified?: boolean;
  }) =>
    request<{ ok: boolean }>("/api/product-intelligence/abbreviations", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  disableAbbreviation: (id: number) =>
    request<{ ok: boolean }>(`/api/product-intelligence/abbreviations/${id}/disable`, { method: "POST" }),

  getSupplierCatalogue: (supplier?: string) =>
    request<{ entries: SupplierCatalogueEntry[] }>(
      `/api/product-intelligence/supplier-catalogue${supplier ? `?supplier=${encodeURIComponent(supplier)}` : ""}`,
    ),
  saveSupplierCatalogue: (payload: {
    supplier_name: string;
    brand?: string;
    supplier_sku?: string;
    manufacturer_part_number?: string;
    product_name?: string;
    product_type?: string;
    full_description?: string;
    material?: string;
    function_use?: string;
    approved_hs_code?: string;
    duty_rate?: string;
    approval_status?: string;
    source_document?: string;
  }) =>
    request<{ ok: boolean }>("/api/product-intelligence/supplier-catalogue", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  verifySupplierCatalogue: (id: number, payload?: { approved_hs_code?: string; duty_rate?: string }) =>
    request<{ ok: boolean }>(`/api/product-intelligence/supplier-catalogue/${id}/verify`, {
      method: "POST",
      body: JSON.stringify(payload || {}),
    }),
  disableSupplierCatalogue: (id: number) =>
    request<{ ok: boolean }>(`/api/product-intelligence/supplier-catalogue/${id}/disable`, { method: "POST" }),

  getProductDictionary: () =>
    request<{ entries: ProductDictionaryEntry[] }>("/api/product-intelligence/product-dictionary"),
  saveProductDictionary: (payload: {
    canonical_name: string;
    synonyms?: string[];
    product_family: string;
    industry_code: string;
    typical_chapter?: string;
    common_materials?: string[];
    typical_uses?: string[];
  }) =>
    request<{ ok: boolean }>("/api/product-intelligence/product-dictionary", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  disableProductDictionary: (id: number) =>
    request<{ ok: boolean }>(`/api/product-intelligence/product-dictionary/${id}`, { method: "DELETE" }),

  getProductFamilyRules: () =>
    request<{
      entries: Array<{
        id: number;
        canonical_product: string;
        alias: string;
        product_family: string;
        likely_chapters: string[];
        likely_headings: string[];
        required_attributes: string[];
        prohibited_chapters: string[];
        priority: number;
        active: boolean;
        notes?: string | null;
      }>;
    }>("/api/product-intelligence/product-family-rules"),
  saveProductFamilyRule: (payload: {
    canonical_product: string;
    alias: string;
    product_family: string;
    likely_chapters?: string[];
    likely_headings?: string[];
    required_attributes?: string[];
    prohibited_chapters?: string[];
    priority?: number;
    notes?: string;
  }) =>
    request<{ ok: boolean }>("/api/product-intelligence/product-family-rules", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  disableProductFamilyRule: (id: number) =>
    request<{ ok: boolean }>(`/api/product-intelligence/product-family-rules/${id}`, { method: "DELETE" }),

  getIndustryDictionary: () =>
    request<{ entries: IndustryDictionaryEntry[] }>("/api/product-intelligence/industry-dictionary"),
  saveIndustryDictionary: (payload: {
    code: string;
    name: string;
    description?: string;
    typical_chapters?: string[];
  }) =>
    request<{ ok: boolean }>("/api/product-intelligence/industry-dictionary", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  getBrandDictionary: () =>
    request<{ entries: BrandDictionaryEntry[] }>("/api/product-intelligence/brand-dictionary"),
  saveBrandDictionary: (payload: {
    brand: string;
    industry_hints?: string[];
    typical_chapters?: string[];
    confidence_boost?: number;
  }) =>
    request<{ ok: boolean }>("/api/product-intelligence/brand-dictionary", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  getQuestionRules: () =>
    request<{ entries: QuestionRuleEntry[] }>("/api/product-intelligence/question-rules"),
  saveQuestionRule: (payload: {
    industry_code?: string;
    product_family?: string;
    questions: unknown[];
    priority?: number;
  }) =>
    request<{ ok: boolean }>("/api/product-intelligence/question-rules", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  getChapterPredictionRules: () =>
    request<{ entries: ChapterPredictionRuleEntry[] }>(
      "/api/product-intelligence/chapter-prediction-rules",
    ),
  saveChapterPredictionRule: (payload: {
    industry_code?: string;
    product_family?: string;
    material?: string;
    function_key?: string;
    chapter: string;
    weight?: number;
  }) =>
    request<{ ok: boolean }>("/api/product-intelligence/chapter-prediction-rules", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  getProductProfiles: () =>
    request<{
      entries: Array<{
        id: number;
        supplier_name: string | null;
        original_description: string;
        selected_hs_code: string | null;
        created_at: string;
      }>;
    }>("/api/product-intelligence/product-profiles"),

  getSupplierIntelligence: () =>
    request<{
      entries: Array<{
        supplier_name: string;
        profile_count: number;
        distinct_hs: number;
        last_seen: string;
      }>;
    }>("/api/product-intelligence/supplier-intelligence"),

  getLearningStats: () =>
    request<{
      total: number;
      by_industry: Array<{ key: string | null; count: number }>;
      by_chapter: Array<{ key: string | null; count: number }>;
    }>("/api/product-intelligence/learning-stats"),

  getAttributeLibrary: () =>
    request<{ entries: import("@pas/shared-types").ProductAttributeLibraryEntry[] }>(
      "/api/product-intelligence/attribute-library",
    ),
  getAttributeLibraryEntry: (id: number) =>
    request<{ entry: import("@pas/shared-types").ProductAttributeLibraryEntry }>(
      `/api/product-intelligence/attribute-library/${id}`,
    ),
  saveAttributeLibrary: (payload: {
    productFamily: string;
    industry: string;
    typicalChapters?: string[];
    requiredAttributes?: import("@pas/shared-types").AttributeDefinition[];
    optionalAttributes?: import("@pas/shared-types").AttributeDefinition[];
    questionOrder?: string[];
    validationRules?: import("@pas/shared-types").AttributeValidationRule[];
  }) =>
    request<{ ok: boolean }>("/api/product-intelligence/attribute-library", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  updateAttributeLibrary: (
    id: number,
    payload: {
      productFamily?: string;
      industry?: string;
      typicalChapters?: string[];
      requiredAttributes?: import("@pas/shared-types").AttributeDefinition[];
      optionalAttributes?: import("@pas/shared-types").AttributeDefinition[];
      questionOrder?: string[];
      validationRules?: import("@pas/shared-types").AttributeValidationRule[];
      status?: string;
    },
  ) =>
    request<{ ok: boolean }>(`/api/product-intelligence/attribute-library/${id}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    }),
  disableAttributeLibrary: (id: number) =>
    request<{ ok: boolean }>(`/api/product-intelligence/attribute-library/${id}`, { method: "DELETE" }),
  exportAttributeLibrary: () =>
    request<{
      exported_at: string;
      profiles: Array<{
        productFamily: string;
        industry: string;
        typicalChapters: string[];
        requiredAttributes: import("@pas/shared-types").AttributeDefinition[];
        optionalAttributes: import("@pas/shared-types").AttributeDefinition[];
        questionOrder: string[];
        validationRules: import("@pas/shared-types").AttributeValidationRule[];
      }>;
    }>("/api/product-intelligence/attribute-library/export/all"),
  importAttributeLibrary: (profiles: unknown[]) =>
    request<{ ok: boolean; imported: number }>("/api/product-intelligence/attribute-library/import", {
      method: "POST",
      body: JSON.stringify({ profiles }),
    }),
  getAttributeAnalytics: () =>
    request<import("@pas/shared-types").AttributeAnalyticsSummary>(
      "/api/product-intelligence/attribute-analytics",
    ),

  getLiquidCompositionRules: () =>
    request<{ entries: import("@pas/shared-types").LiquidCompositionRuleEntry[] }>(
      "/api/product-intelligence/liquid-composition-rules",
    ),
  saveLiquidCompositionRule: (payload: Record<string, unknown>) =>
    request<{ ok: boolean }>("/api/product-intelligence/liquid-composition-rules", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  updateLiquidCompositionRule: (id: number, payload: Record<string, unknown>) =>
    request<{ ok: boolean }>(`/api/product-intelligence/liquid-composition-rules/${id}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    }),
  getLiquidCompositions: () =>
    request<{ entries: Array<Record<string, unknown>> }>("/api/product-intelligence/liquid-compositions"),
  approveLiquidComposition: (id: number) =>
    request<{ ok: boolean }>(`/api/product-intelligence/liquid-compositions/${id}/approve`, {
      method: "POST",
    }),
  getLiquidConflicts: () =>
    request<{ entries: Array<Record<string, unknown>> }>("/api/product-intelligence/liquid-conflicts"),
  extractLiquidComposition: (text: string, source?: string) =>
    request<{ composition: import("@pas/shared-types").LiquidCompositionComponent[] }>(
      "/api/product-intelligence/liquid-extract",
      { method: "POST", body: JSON.stringify({ text, source }) },
    ),

  getSupplierHistory: (params?: { q?: string; supplier?: string; limit?: number }) => {
    const qs = new URLSearchParams();
    if (params?.q) qs.set("q", params.q);
    if (params?.supplier) qs.set("supplier", params.supplier);
    if (params?.limit) qs.set("limit", String(params.limit));
    const query = qs.toString();
    return request<{ entries: SupplierClassificationEntry[] }>(
      `/api/supplier-history${query ? `?${query}` : ""}`,
    );
  },

  saveSupplierHistory: (payload: {
    supplier_name: string;
    item_description: string;
    hs_code: string;
    duty_rate: string;
    tariff_description?: string;
    part_number?: string;
    model_number?: string;
    brand?: string;
    match_type?: string;
    source_job_id?: string;
    confidence?: number;
  }) =>
    request<{ ok: boolean; id?: number }>("/api/supplier-history", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  updateSupplierHistory: (id: number, payload: { hs_code?: string; duty_rate?: string; disabled?: boolean }) =>
    request<{ ok: boolean }>(`/api/supplier-history/${id}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    }),

  mergeSuppliers: (from_supplier: string, to_supplier: string) =>
    request<{ ok: boolean }>("/api/supplier-history/merge", {
      method: "POST",
      body: JSON.stringify({ from_supplier, to_supplier }),
    }),

  exportSupplierHistory: () =>
    request<{ entries: SupplierClassificationEntry[]; exported_at: string }>("/api/supplier-history/export"),

  uploadDocumentForProcessing: (payload: {
    base64: string;
    mediaType: string;
    filename: string;
    pagesTotalHint?: number;
  }) =>
    request<{
      success: boolean;
      jobId: string;
      documentId: string;
      status: string;
      pagesTotal: number;
      message?: string;
    }>("/api/document-processing/upload", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  getDocumentJob: (jobId: string) =>
    request<DocumentProcessingJobStatus>(`/api/document-processing/jobs/${encodeURIComponent(jobId)}`),

  advanceDocumentJob: (jobId: string) =>
    request<DocumentProcessingJobStatus>(
      `/api/document-processing/jobs/${encodeURIComponent(jobId)}/advance`,
      { method: "POST", body: "{}" },
      120_000,
    ),

  retryDocumentJob: (jobId: string) =>
    request<DocumentProcessingJobStatus>(
      `/api/document-processing/jobs/${encodeURIComponent(jobId)}/retry`,
      { method: "POST", body: "{}" },
      120_000,
    ),

  cancelDocumentJob: (jobId: string) =>
    request<DocumentProcessingJobStatus>(
      `/api/document-processing/jobs/${encodeURIComponent(jobId)}/cancel`,
      { method: "POST", body: "{}" },
    ),

  /** Resume / continue advancing until job completes (after retry or mid-flight). */
  continueDocumentJob: (jobId: string, onProgress?: (job: DocumentProcessingJobStatus) => void) =>
    runDocumentJobToCompletion(jobId, onProgress),

  /** Upload → background page-batch processing → extracted invoices */
  processDocument: async (
    file: File,
    onProgress?: (job: DocumentProcessingJobStatus) => void,
    options?: { shipmentId?: string; documentType?: string },
  ): Promise<ParsedInvoiceResult> => {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result || ""));
      r.onerror = () => reject(new Error("Read failed"));
      r.readAsDataURL(file);
    });
    const base64 = dataUrl.includes(",") ? dataUrl.split(",")[1] : dataUrl;
    const mediaType = file.type || "application/pdf";

    let pagesTotalHint = 0;
    try {
      if (mediaType === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
        const { PDFDocument } = await import("pdf-lib");
        const bytes = new Uint8Array(await file.arrayBuffer());
        const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
        pagesTotalHint = doc.getPageCount();
      } else {
        pagesTotalHint = 1;
      }
    } catch {
      pagesTotalHint = 0;
    }

    const uploaded = await request<{
      success: boolean;
      jobId: string;
      documentId: string;
      status: string;
      pagesTotal: number;
      message?: string;
    }>("/api/document-processing/upload", {
      method: "POST",
      body: JSON.stringify({
        base64,
        mediaType,
        filename: file.name,
        pagesTotalHint,
        shipmentId: options?.shipmentId,
        documentType: options?.documentType,
      }),
    });
    onProgress?.({
      success: true,
      jobId: uploaded.jobId,
      documentId: uploaded.documentId,
      status: uploaded.status,
      pagesTotal: uploaded.pagesTotal || pagesTotalHint,
      pagesCompleted: 0,
      progressPercent: 0,
      currentStage: uploaded.message || "Queued",
    });

    return runDocumentJobToCompletion(
      uploaded.jobId,
      onProgress,
      Boolean(options?.documentType && options.documentType !== "commercial_invoice"),
    );
  },

  /** @deprecated Prefer processDocument — kept for compatibility */
  parseInvoice: async (base64: string, mediaType: string) => {
    const uploaded = await request<{
      success: boolean;
      jobId: string;
      documentId: string;
      status: string;
      pagesTotal: number;
    }>("/api/document-processing/upload", {
      method: "POST",
      body: JSON.stringify({ base64, mediaType, filename: "invoice.pdf" }),
    });
    return runDocumentJobToCompletion(uploaded.jobId);
  },

  getLearned: () => request<{ entries: LearnedEntry[] }>("/api/learned"),

  saveLearned: (payload: {
    desc: string;
    tariff_code: string;
    duty_rate: string;
    category: string;
  }) =>
    request<{ ok: boolean }>("/api/learned", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  deleteLearned: (key: string) =>
    request<{ ok: boolean }>(`/api/learned/${encodeURIComponent(key)}`, { method: "DELETE" }),

  clearLearned: () => request<{ ok: boolean }>("/api/learned", { method: "DELETE" }),

  getExchangeRate: () => request<ExchangeRate>("/api/exchange-rate"),

  updateExchangeRate: (rate: number, updatedBy: string) =>
    request<ExchangeRate>("/api/exchange-rate", {
      method: "PUT",
      body: JSON.stringify({ rate, updatedBy }),
    }),

  getConsignees: () => request<{ consignees: Consignee[] }>("/api/workflow/consignees"),

  saveConsignees: (consignees: Consignee[]) =>
    request<{ ok: boolean }>("/api/workflow/consignees", {
      method: "PUT",
      body: JSON.stringify({ consignees }),
    }),

  getTaxLog: () => request<{ entries: TaxLogEntry[] }>("/api/workflow/tax-log"),

  appendTaxLogRemote: (entry: TaxLogEntry) =>
    request<{ ok: boolean }>("/api/workflow/tax-log", {
      method: "POST",
      body: JSON.stringify(entry),
    }),

  getCurrentJob: () =>
    request<{ job: { id: string; state: unknown; updatedAt: string } | null }>("/api/jobs/current"),

  saveCurrentJob: (state: JobState, jobId?: string | null) =>
    request<{ id: string; updatedAt: string }>("/api/jobs/current", {
      method: "PUT",
      body: JSON.stringify({ state, jobId: jobId ?? null }),
    }),

  markJobSent: (id: string, payload: { jobType: DutyDeskJobType; worksheetNum: string }) =>
    request<{ ok: boolean; status: string }>(`/api/jobs/${encodeURIComponent(id)}/sent`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  abandonJob: (id: string) =>
    request<{ ok: boolean; status: string }>(`/api/jobs/${encodeURIComponent(id)}/abandon`, {
      method: "POST",
    }),

  sendToFlowBoard: (payload: {
    entry: TaxLogEntry & { customerEmail?: string };
    documentType?: "worksheet" | "brokerage_quote" | "tax_quote";
    jobType?: "classification_only" | "brokerage_clearance";
    worksheetPdfBase64?: string;
    breakdownPdfBase64?: string;
    quotePdfBase64?: string;
    taxBreakdown?: Record<string, unknown>;
    quoteData?: Record<string, unknown>;
    classificationRows?: unknown[];
    invoiceFilenames?: string[];
    itemizedReportPdfBase64?: string;
    originalInvoicePdfBase64?: string;
    worksheetPackagePdfBase64?: string;
    includeItemizedReport?: boolean;
    jobId?: string;
    idempotencyKey?: string;
    jobPackage?: Record<string, unknown>;
    workflowInstructions?: Record<string, unknown>;
    sentToCustomerVia?: Array<"email" | "whatsapp" | "portal">;
    notes?: string;
    customerVisibleNote?: boolean;
  }) =>
    request<{
      ok: boolean;
      flowboardReference?: string;
      jobId?: string;
      flowboardJobUrl?: string;
      message?: string;
      created?: boolean;
    }>(
      "/api/workflow/flowboard/send",
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
      LONG_TIMEOUT_MS,
    ),

  searchFlowboardJobs: (q: string) =>
    request<{
      success: boolean;
      jobs: Array<{
        id: string;
        reference: string;
        title: string;
        customerName: string;
        customerEmail?: string;
        columnId?: string;
        status?: string;
        publicStatus?: string;
      }>;
      error?: string;
    }>(`/api/workflow/flowboard/jobs/search?q=${encodeURIComponent(q)}`),

  getEmailStatus: () =>
    request<{ configured: boolean; from?: string; provider?: string }>("/api/email/status"),

  pingEmail: () =>
    request<{
      ok: boolean;
      urlEndsWithExec?: boolean;
      get?: { ok: boolean; snippet?: string };
      post?: { ok: boolean; error?: string; detail?: string };
      error?: string;
    }>("/api/email/ping"),

  sendEmail: (payload: {
    to: string;
    cc?: string;
    subject: string;
    html: string;
    fromName?: string;
    fromAddress?: string;
    replyTo?: string;
    attachments?: Array<{ filename: string; content: string; mimeType?: string }>;
  }) =>
    request<{ ok: boolean; id?: string }>("/api/email/send", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  createTaxAdviceShare: (payload: {
    pdfBase64: string;
    worksheetNum?: string;
    consigneeName?: string;
    filename?: string;
  }) =>
    request<{
      ok: boolean;
      token: string;
      viewUrl: string;
      viewerUrl?: string;
      downloadUrl: string;
      expiresAt: string;
    }>("/api/tax-advice/share", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  getUsers: () => request<{ users: TeamUser[] }>("/api/users"),

  createUser: (payload: { username: string; password: string; name: string; role: "admin" | "clerk" }) =>
    request<{ user: TeamUser }>("/api/users", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  updateUser: (
    id: number,
    payload: { name?: string; role?: "admin" | "clerk"; password?: string },
  ) =>
    request<{ user: TeamUser }>(`/api/users/${id}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    }),

  deleteUser: (id: number) =>
    request<{ ok: boolean }>(`/api/users/${id}`, { method: "DELETE" }),
};
