export type UserRole = "admin" | "clerk";

export interface User {
  id: number;
  username: string;
  name: string;
  role: UserRole;
}

export interface SessionUser {
  id: number;
  username: string;
  name: string;
  role: UserRole;
}

export interface TeamUser {
  id: number;
  username: string;
  name: string;
  role: UserRole;
  createdAt: string;
}

export type ItemSource =
  | "database"
  | "learned"
  | "supplier_exact"
  | "supplier_fuzzy"
  | "product_intelligence"
  | "ai"
  | "manual";

export type ItemStatus = "done" | "loading" | "needs_ai" | "error" | "needs_review";

export interface ProductProfile {
  productName: string;
  normalizedName: string;
  industry: string | null;
  industryCode: string | null;
  productFamily: string | null;
  productType: string | null;
  material: string | null;
  composition: string | null;
  primaryFunction: string | null;
  primaryUse: string | null;
  commercialUse: boolean;
  consumerUse: boolean;
  brand: string | null;
  model: string | null;
  partNumber: string | null;
  supplier: string | null;
  countryOfOrigin: string | null;
  gender: string | null;
  ageGroup: string | null;
  food: boolean;
  chemical: boolean;
  medical: boolean;
  electrical: boolean;
  vehicle: boolean;
  construction: boolean;
  textile: boolean;
  footwear: boolean;
  machine: boolean;
  tool: boolean;
  hazardous: boolean;
  fragile: boolean;
  temperatureControlled: boolean;
  attributes: Record<string, string | number | boolean | null>;
}

export interface HeadingCandidate {
  hs_code: string;
  heading: string;
  title: string;
  score: number;
  duty_rate?: string;
}

export interface ProductPrediction {
  chapter: string | null;
  chapterConfidence: number;
  chapterTitle?: string | null;
  headings: HeadingCandidate[];
  subheading?: string | null;
  predictedHsCode?: string | null;
  predictedDuty?: string | null;
  /** Broad product domain used for chapter gating (before Explanatory Notes). */
  domain?: string | null;
  domainLabel?: string | null;
  domainConfidence?: number;
  allowedChapters?: string[];
  excludedChapters?: string[];
  /** Explanatory Note validation outcome for top candidates (post-gating only). */
  enValidation?: Array<{
    heading: string;
    hs_code: string;
    status: "included" | "excluded" | "neutral" | "unavailable";
    noteExcerpt?: string;
  }>;
}

export interface ProductQuestion {
  id: string;
  field: string;
  prompt: string;
  options?: string[];
  required: boolean;
}

export interface ProductQuestionAnswer {
  question_id: string;
  field: string;
  value: string;
}

export type ProductResolverSource =
  | "supplier_exact"
  | "previous_approved"
  | "alias_exact"
  | "alias_fuzzy"
  | "product_dictionary"
  | "brand"
  | "token_match"
  | "manual";

export interface ProductResolverCandidate {
  canonicalProductId: number;
  canonicalName: string;
  confidence: number;
  source: ProductResolverSource;
  matchedAlias?: string | null;
  industry: string | null;
  productFamily: string | null;
  typicalMaterials: string[];
  typicalChapters: string[];
  commonUses: string[];
  typicalAttributes: string[];
  approvedTariff?: string | null;
  supplierCount: number;
  previousImports: number;
  approvalRate: number;
  reasons: string[];
}

export interface ProductResolution {
  originalDescription: string;
  normalizedQuery: string;
  status: "identified" | "needs_confirmation" | "unresolved";
  confidence: number;
  selected: ProductResolverCandidate | null;
  suggestions: ProductResolverCandidate[];
  missingInformation: string[];
  resolverPath: string[];
}

export interface EvidenceParsedDescription {
  rawDescription: string;
  possibleProductCode: string;
  possibleSku: string;
  possibleBrand: string;
  possibleManufacturer: string;
  productWords: string[];
  attributes: {
    colour: string;
    size: string;
    dimensions: string;
    quantity: string;
    model: string;
    grade: string;
    material: string;
  };
  unresolvedTokens: string[];
  coreDescription: string;
}

export type ProductEvidenceSource =
  | "supplier_product_code"
  | "previous_approved"
  | "product_master"
  | "supplier_catalogue"
  | "alias"
  | "brand_manufacturer"
  | "similar_import"
  | "attached_document"
  | "ai_interpretation"
  | "external_lookup";

export interface ProductEvidenceResult {
  id?: number;
  source: ProductEvidenceSource;
  matchedValue: string;
  productIdentity: string;
  supplier: string;
  productCode: string;
  brand: string;
  manufacturer: string;
  material: string;
  function: string;
  approvedTariff: string;
  confidence: number;
  isApproved: boolean;
  documentReference: string;
  explanation?: string;
}

export interface EvidenceResolvedProduct {
  productMasterId?: number | null;
  canonicalName: string;
  displayName: string;
  productFamily: string;
  industry: string;
  brand: string;
  manufacturer: string;
  productCode: string;
  material: string;
  primaryFunction: string;
  intendedUse: string;
  attributes?: Record<string, string>;
}

export interface EvidenceProductResolution {
  resolutionId?: number;
  status: "resolved" | "possible_matches" | "unresolved";
  rawDescription: string;
  parsed: EvidenceParsedDescription;
  resolvedProduct: EvidenceResolvedProduct | null;
  evidence: ProductEvidenceResult[];
  confidence: number;
  missingInformation: string[];
  possibleMatches: Array<{
    product: EvidenceResolvedProduct;
    confidence: number;
    evidenceSummary: string;
  }>;
  relatedProductGroup?: string | null;
}

export type ClassificationLineStatus =
  | "Generating Suggestions"
  | "Suggestion Ready"
  | "More Information Needed"
  | "Applied"
  | "Needs Manual Review"
  | "Failed"
  // Legacy statuses kept for older persisted lines
  | "Parsing Description"
  | "Searching Evidence"
  | "Product Resolved"
  | "Possible Matches"
  | "Product Unresolved"
  | "Recommendation Ready"
  | "AI Applied"
  | "Clerk Edited"
  | "Needs Review";

export type ConfidenceLabel =
  | "Strong Match"
  | "Likely Match"
  | "Possible Match"
  | "More Information Needed";

export type SimpleRecommendationStatus =
  | "recommended"
  | "provisional"
  | "clarification_needed"
  | "unable_to_classify";

export interface ClassificationRecommendationCandidate {
  code: string;
  description: string;
  chapter: string;
  dutyRate: number;
  vatRate: number;
  levyRate?: number;
  reason: string;
  source: "ai" | "product_intelligence";
  confidence?: number;
  confidenceLabel?: ConfidenceLabel;
  provisional?: boolean;
  officialVerification?: {
    source: "ttbizlink";
    status: "verified" | "cached" | "not_found" | "unavailable";
    officialDescription?: string;
    officialDutyRate?: string;
    lookedUpAt: string;
    url: string;
  };
}

export interface ClassificationInterpretation {
  productName: string;
  productType: string;
  likelyMaterial: string;
  primaryFunction: string;
  industry: string;
}

export interface ClassificationClarificationQuestion {
  id: string;
  prompt: string;
  options: string[];
}

export interface ClassificationRecommendationResponse {
  status: SimpleRecommendationStatus | "recommendation_ready" | "no_reliable_match";
  interpretation?: ClassificationInterpretation;
  recommendations?: ClassificationRecommendationCandidate[];
  question?: ClassificationClarificationQuestion | null;
  warnings?: string[];
  productProfile?: {
    identifiedItem: string;
    material: string;
    productFamily: string;
    primaryUse: string;
  };
  /** @deprecated Prefer recommendations[0] */
  recommendedCandidate: ClassificationRecommendationCandidate | null;
  /** @deprecated Prefer recommendations.slice(1) */
  alternatives: ClassificationRecommendationCandidate[];
}

/** Configurable attribute definition within a product family profile. */
export interface AttributeDefinition {
  key: string;
  label: string;
  prompt: string;
  synonyms?: string[];
  options?: string[];
  defaultValue?: string;
  dataType?: "string" | "boolean" | "number" | "enum";
  inferencePatterns?: string[];
  confidenceThreshold?: number;
}

export interface AttributeValidationRule {
  attributeKey: string;
  rule: "required" | "required_if" | "one_of" | "regex" | "mutually_exclusive";
  params?: Record<string, unknown>;
  message?: string;
}

/** Data-driven Product Attribute Library profile per product family. */
export interface ProductAttributeLibraryEntry {
  id: number;
  productFamily: string;
  industry: string;
  typicalChapters: string[];
  requiredAttributes: AttributeDefinition[];
  optionalAttributes: AttributeDefinition[];
  questionOrder: string[];
  validationRules: AttributeValidationRule[];
  status: string;
  created_at?: string;
  updated_at?: string;
}

export interface InferredAttribute {
  key: string;
  value: string;
  confidence: number;
  source:
    | "ocr"
    | "product_dictionary"
    | "brand_dictionary"
    | "supplier_history"
    | "attribute_learning"
    | "clerk"
    | "profile"
    | "default";
}

export interface AttributeLearningEntry {
  id: number;
  learning_key: string;
  supplier_name: string | null;
  normalized_supplier: string | null;
  model_number: string | null;
  part_number: string | null;
  product_key: string | null;
  product_family: string | null;
  attribute_key: string;
  attribute_value: string;
  confidence: number;
  usage_count: number;
  source: string;
}

export interface AttributeAnalyticsSummary {
  most_asked: Array<{ attribute_key: string; count: number }>;
  missing_attributes: Array<{ attribute_key: string; count: number }>;
  auto_inferred: Array<{ attribute_key: string; count: number }>;
  average_questions_per_classification: number;
  question_reduction_pct: number;
  confidence_improvements: number;
  classification_accuracy_improvements: number;
  total_asked: number;
  total_inferred: number;
  total_answered: number;
  total_classifications: number;
}

/** Liquid / semi-liquid physical forms. */
export type LiquidPhysicalForm =
  | "liquid"
  | "semi-liquid"
  | "gel"
  | "paste"
  | "emulsion"
  | "suspension"
  | "solution"
  | "oil"
  | "syrup"
  | "concentrate"
  | "cream"
  | "aerosol"
  | "other";

export type LiquidComponentRole =
  | "active"
  | "base"
  | "solvent"
  | "preservative"
  | "fragrance"
  | "colour"
  | "carrier"
  | "additive"
  | "other";

export type LiquidComponentSource =
  | "invoice"
  | "SDS"
  | "COA"
  | "label"
  | "product specification"
  | "TDS"
  | "catalogue"
  | "packing list"
  | "clerk"
  | "learned"
  | "pattern";

export interface LiquidCompositionComponent {
  name: string;
  normalizedName: string;
  percentage: number | null;
  percentageMin?: number | null;
  percentageMax?: number | null;
  concentrationUnit: string;
  isBalance?: boolean;
  isTrace?: boolean;
  casNumber: string | null;
  role: LiquidComponentRole;
  confidence: number;
  source: LiquidComponentSource;
}

export interface LiquidProductProfile {
  physicalForm: LiquidPhysicalForm | null;
  liquidType: string | null;
  primaryFunction: string | null;
  commercialUse: string | null;
  composition: LiquidCompositionComponent[];
  activeIngredients: string[];
  baseSubstance: string | null;
  solvent: string | null;
  concentration: string | null;
  waterContentPercent: number | null;
  alcoholContentPercent: number | null;
  oilContentPercent: number | null;
  sugarContentPercent: number | null;
  acidContentPercent: number | null;
  purityPercent: number | null;
  foodGrade: boolean | null;
  pharmaceuticalGrade: boolean | null;
  cosmeticGrade: boolean | null;
  industrialGrade: boolean | null;
  hazardous: boolean | null;
  casNumbers: string[];
  unNumber: string | null;
  ph: number | null;
  viscosity: string | null;
  density: string | null;
  packagingForm: string | null;
  intendedUse: string | null;
  essentialCharacterComponent: string | null;
  essentialCharacterReason: string | null;
  competingComponents: string[];
  classificationImpact: string | null;
  finishedRetailPreparation: boolean | null;
  concentrated: boolean | null;
  documentsAvailable: string[];
}

export interface LiquidCompositionConfidences {
  productIdentity: number;
  physicalForm: number;
  compositionCompleteness: number;
  activeIngredient: number;
  primaryUse: number;
  essentialCharacter: number;
  chapterPrediction: number;
  headingPrediction: number;
  finalClassification: number;
}

export interface LiquidCompositionConflict {
  conflict_type: string;
  description: string;
  left_source?: string;
  right_source?: string;
}

export interface LiquidCompositionRuleEntry {
  id: number;
  liquid_type: string;
  display_name: string;
  typical_chapters: string[];
  required_fields: string[];
  composition_thresholds: Array<{
    field: string;
    min?: number;
    max?: number;
    chapterHint?: string;
    headingHint?: string;
    note?: string;
  }>;
  active_ingredient_mappings: Array<{ pattern: string; ingredient: string; role?: string }>;
  solvent_base_mappings: Array<{ pattern: string; value: string; kind: "solvent" | "base" }>;
  chemical_synonyms: Array<{ synonym: string; canonical: string }>;
  cas_mappings: Array<{ name: string; cas: string }>;
  classification_hints: Array<{ when: string; chapter?: string; note?: string }>;
  status: string;
}

export interface LiquidCompositionLearningEntry {
  id: number;
  identity_key: string;
  supplier_name: string | null;
  brand: string | null;
  product_name: string | null;
  model_number: string | null;
  part_number: string | null;
  manufacturer: string | null;
  liquid_profile: LiquidProductProfile;
  composition: LiquidCompositionComponent[];
  essential_character_component: string | null;
  essential_character_reason: string | null;
  approved: boolean;
  usage_count: number;
}

export interface ClassificationExplainability {
  productName: string;
  normalizedName: string;
  industry: string | null;
  productFamily: string | null;
  attributes: Record<string, string | null>;
  attributeConfidences?: Record<string, number>;
  inferredAttributes?: InferredAttribute[];
  liquidProfile?: LiquidProductProfile;
  liquidConfidences?: LiquidCompositionConfidences;
  predictedChapter: string | null;
  predictedHeading: string | null;
  predictedSubheading: string | null;
  confidence: number;
  questionsAsked: string[];
  knowledgeSources: string[];
  reasoningSummary: string;
  gaps?: string[];
  parsedDescription?: ParsedLineDescription;
  identityStatus?: ProductIdentityStatus;
  identityConfidence?: number;
  /** Classification path stages for UI. */
  classificationPath?: string[];
  domain?: string | null;
  domainLabel?: string | null;
  /** Warning when selected/suggested tariff conflicts with predicted domain. */
  domainConflictWarning?: string | null;
  enValidationStatus?: string | null;
}

export interface LineItem {
  id: number;
  desc: string;
  qty: number;
  unit: string;
  price: number;
  /** Printed line extension from invoice — used for totals when set. */
  line_total?: number;
  tariff_code: string | null;
  duty_rate: string | null;
  category: string | null;
  notes: string | null;
  status: ItemStatus;
  source: ItemSource;
  /** Part/model extracted from description when available. */
  part_number?: string;
  model_number?: string;
  /** Match confidence 0–1 for supplier fuzzy / AI. */
  match_confidence?: number;
  /** Human-readable match type label. */
  match_type?: MatchTypeLabel;
  /** Supplier history row id when matched from history. */
  supplier_history_id?: number;
  /** Usage count from supplier history match. */
  supplier_usage_count?: number;
  /** Last used date from supplier history. */
  supplier_last_used_at?: string;
  /** Clerk approved the underlying supplier history entry. */
  supplier_clerk_approved?: boolean;
  /** Conflict flag when multiple HS codes exist for same item. */
  classification_conflict?: boolean;
  /** Competing headings considered. */
  competing_headings?: string[];
  /** Why alternative codes were rejected. */
  why_rejected?: string[];
  /** Heading (4/6-digit) primarily considered. */
  heading_considered?: string;
  /** Clerk review required after AI. */
  requires_clerk_review?: boolean;
  /** Classification path stages. */
  classification_path?: string[];
  /** Estimated tokens saved by skipping AI. */
  token_savings_estimate?: number;
  /** Whether AI was skipped for this line. */
  ai_skipped?: boolean;
  /** Structured product intelligence profile. */
  product_profile?: ProductProfile;
  /** Chapter/heading predictions. */
  predictions?: ProductPrediction;
  /** Questions still needed from clerk. */
  pending_questions?: ProductQuestion[];
  /** Answers provided by clerk. */
  question_answers?: ProductQuestionAnswer[];
  /** Explainability panel payload. */
  explainability?: ClassificationExplainability;
  /** Persisted product profile id after save. */
  product_profile_id?: number;
  /** Attribute confidence map from Product Attribute Library engine. */
  attribute_confidences?: Record<string, number>;
  /** Inferred attributes with sources. */
  inferred_attributes?: InferredAttribute[];
  /** Liquid / mixture composition profile when applicable. */
  liquid_profile?: LiquidProductProfile;
  /** Composition confidence breakdown. */
  liquid_confidences?: LiquidCompositionConfidences;
  /** Detected composition conflicts. */
  liquid_conflicts?: LiquidCompositionConflict[];
  /** Whether liquid composition gates high-confidence classification. */
  liquid_requires_review?: boolean;
  /** Step 19: parsed invoice line identity. */
  parsed_description?: ParsedLineDescription;
  /** Compact document/adjacent context for identity. */
  line_context?: LineContextSummary;
  /** Whether product identity blocks HS classification. */
  identity_unresolved?: boolean;
  /** Product-first resolution. Tariff suggestions remain hidden until confirmed. */
  product_resolution?: ProductResolution;
  evidence_resolution?: EvidenceProductResolution;
  parsed_product_clues?: EvidenceParsedDescription;
  canonical_product_id?: number;
  product_confirmed?: boolean;
  tariff_description?: string | null;
  vat_rate?: string | null;
  levy_rate?: string | null;
  classification_status?: ClassificationLineStatus;
  classification_recommendation?: ClassificationRecommendationResponse;
  recommendation_source?: "ai_recommendation" | "clerk_edited_ai_recommendation";
  recommendation_evidence?: ProductEvidenceResult[];
}

export interface InvoiceMeta {
  number: string;
  date: string;
  supplier: string;
  from: string;
  to: string;
  clerk: string;
  /** Invoice currency for prices/freight/insurance (default USD). */
  currency: string;
  /** For non-USD invoices: 1 <currency> = TT$ rate used to convert values. */
  currencyRateToTTD: string;
  /** Goods subtotal printed on the supplier invoice (if detected). */
  documentGoodsTotal: string;
  /** Grand total printed on the supplier invoice (if detected). */
  documentGrandTotal: string;
  /** Freight, insurance, sales tax, and other CIF charges detected or entered manually. */
  charges: InvoiceCharge[];
  /** Line items do not match document totals — needs clerk review. */
  totalsMismatch: boolean;
  /** Clerk acknowledged totals mismatch after review. */
  totalsReviewed: boolean;
  /** Durable document-processing job used to search attached shipment evidence. */
  sourceJobId?: string;
}

export type InvoiceChargeKind = "freight" | "insurance" | "sales_tax" | "other";

export interface InvoiceCharge {
  id: string;
  kind: InvoiceChargeKind;
  label: string;
  amount: string;
  /** Included in customs CIF value (default true). */
  includeInCif: boolean;
}

export interface Invoice {
  id: number;
  filename: string;
  meta: InvoiceMeta;
  items: LineItem[];
  status: "done" | "processing";
}

export interface TariffEntry {
  code: string;
  desc: string;
  duty: string;
  score?: number;
}

export interface ClassifyResult {
  tariff_code: string;
  duty_rate: string;
  category: string;
  notes: string;
}

/** Compact batch AI classification result per line. */
export interface BatchClassifyItemResult {
  line_id: number;
  suggested_hs_code: string;
  selected_hs_code?: string;
  tariff_description: string;
  confidence: number;
  reason_short: string;
  needs_review: boolean;
  requires_review?: boolean;
  competing_headings?: string[];
  alternative_codes?: string[];
  classification_source?: "ai" | "product_intelligence";
  ai_skipped?: boolean;
}

export interface BatchClassifyRequest {
  supplier_name: string;
  items: Array<{
    line_id: number;
    description: string;
    part_number?: string;
    model_number?: string;
    material?: string;
    function_use?: string;
    value?: number;
    quantity?: number;
    previous_matches?: Array<{ hs_code: string; score: number }>;
    candidate_hs_code?: string;
    product_profile?: ProductProfile;
    chapter_prediction?: string | null;
    heading_candidates?: HeadingCandidate[];
    brand?: string | null;
    industry?: string | null;
    product_family?: string | null;
    liquid_profile?: LiquidProductProfile;
    liquid_confidences?: LiquidCompositionConfidences;
  }>;
}

export interface BatchClassifyResponse {
  results: BatchClassifyItemResult[];
  tokens_saved_estimate?: number;
  items_sent?: number;
  ai_token_estimate?: number;
  classification_logs?: Array<{
    line_id: number;
    path: string[];
    ai_skipped: boolean;
    chunks_retrieved: number;
    token_savings_estimate: number;
  }>;
}

export interface ProductDictionaryEntry {
  id: number;
  canonical_name: string;
  normalized_key: string;
  synonyms: string[];
  product_family: string;
  industry_code: string;
  typical_chapter: string | null;
  common_materials: string[];
  typical_uses: string[];
  status: string;
  usage_count: number;
}

export interface IndustryDictionaryEntry {
  id: number;
  code: string;
  name: string;
  description: string | null;
  typical_chapters: string[];
  status: string;
}

export interface BrandDictionaryEntry {
  id: number;
  brand: string;
  normalized_brand: string;
  industry_hints: string[];
  typical_chapters: string[];
  confidence_boost: number;
  status: string;
  usage_count: number;
}

export interface QuestionRuleEntry {
  id: number;
  industry_code: string | null;
  product_family: string | null;
  questions: ProductQuestion[];
  priority: number;
  status: string;
}

export interface ChapterPredictionRuleEntry {
  id: number;
  industry_code: string | null;
  product_family: string | null;
  material: string | null;
  function_key: string | null;
  chapter: string;
  weight: number;
  usage_count: number;
  status: string;
}

export interface ProductIntelligenceAnalyzeResult {
  line_id: number;
  profile: ProductProfile;
  predictions: ProductPrediction;
  pending_questions: ProductQuestion[];
  explainability: ClassificationExplainability;
  skip_ai?: boolean;
  suggested_hs_code?: string | null;
  duty_rate?: string | null;
  source?: ItemSource;
  match_type?: MatchTypeLabel;
  confidence?: number;
  attribute_confidences?: Record<string, number>;
  inferred_attributes?: InferredAttribute[];
  liquid_profile?: LiquidProductProfile;
  liquid_confidences?: LiquidCompositionConfidences;
  liquid_conflicts?: LiquidCompositionConflict[];
  liquid_requires_review?: boolean;
  parsed_description?: ParsedLineDescription;
  line_context?: LineContextSummary;
  identity_unresolved?: boolean;
}

export interface SupplierClassificationEntry {
  id: number;
  supplier_name: string;
  normalized_supplier_name: string;
  item_description: string;
  normalized_description: string;
  part_number?: string;
  model_number?: string;
  brand?: string;
  hs_code: string;
  tariff_description?: string;
  duty_rate: string;
  vat_rate: string;
  confidence: number;
  match_type: string;
  approved_by_clerk: boolean;
  source_job_id?: string;
  usage_count: number;
  disabled: boolean;
  last_used_at: string;
  created_at: string;
  updated_at: string;
}

export interface ParsedInvoice {
  invoice_number: string | null;
  invoice_date: string | null;
  supplier: string | null;
  ship_from: string | null;
  ship_to: string | null;
  goods_subtotal: number | null;
  invoice_total: number | null;
  charges: Array<{
    kind: string;
    label: string;
    amount: number;
  }>;
  items: Array<{
    description: string;
    qty: number;
    unit: string;
    unit_price: number;
    line_total: number;
  }>;
}

export interface ParsedInvoiceResult {
  invoices: ParsedInvoice[];
}

export interface LearnedEntry {
  normalized_desc: string;
  tariff_code: string;
  duty_rate: string;
  category: string;
  uses: number;
  learned_at: string;
  updated_by: string;
}

export interface ExchangeRate {
  rate: number;
  updated_by: string;
  updated_at: string;
}

export interface TaxInputs {
  freight: string;
  insurance: string;
  /** Sales tax + other charges added to CIF (USD equivalent when combining currencies). */
  otherCharges: string;
  /** Worksheet exchange rate override (1 USD = TTD). Blank uses team default. */
  exchangeRate: string;
  containerSize: "none" | "20ft" | "40ft";
  /** Number of containers at the selected size (CES fee is per container). */
  containerCount?: number;
  userFee: boolean;
  vatExempt: boolean;
  combineAll: boolean;
  worksheetNum?: string;
  billOfLading?: string;
  commodityDesc?: string;
  depositFee?: string;
  manualDuty?: string;
  manualVat?: string;
}

export type WorksheetReviewStatus = "pending" | "reviewed";

/** Per-invoice line on the worksheet — preserves original extraction separately from clerk edits. */
export interface WorksheetSourceLine {
  id: number;
  source_line_number: number;
  original_description: string;
  worksheet_description: string;
  hs_code: string | null;
  duty_rate: string | null;
  vat_rate: string;
  quantity: number;
  value: number;
  duty_amount: number;
  vat_amount: number;
  group_id: string | null;
  reviewed_status: WorksheetReviewStatus;
  /** When true, auto-group will not re-group this line (clerk ungrouped). */
  auto_group_exempt?: boolean;
  internal_notes?: string;
  match_confidence?: number;
  requires_clerk_review?: boolean;
  source?: ItemSource;
}

/** Aggregated worksheet line when multiple invoice lines share a classification/group. */
export interface WorksheetGroupedLine {
  group_id: string;
  hs_code: string | null;
  worksheet_description: string;
  source_line_ids: number[];
  source_line_numbers: number[];
  total_quantity: number;
  total_value: number;
  duty_rate: string | null;
  vat_rate: string;
  total_duty: number;
  total_vat: number;
  reviewed_status: WorksheetReviewStatus;
  internal_notes?: string;
  edited_by?: string;
  edited_at?: string;
}

export interface WorksheetLineState {
  worksheetNum: string;
  sourceLines: WorksheetSourceLine[];
  updatedAt: string;
}

export interface WorksheetValidationIssue {
  level: "error" | "warning";
  message: string;
  lineIds?: number[];
  groupId?: string;
}

export interface TaxBreakdownRow {
  desc: string;
  tariff_code: string | null;
  duty_rate: string | null;
  vat_rate?: string;
  qty?: number;
  itemCIF: number;
  duty: number;
  vat: number;
  isDutyExempt: boolean;
  isVatExempt: boolean;
  source_line_number?: number;
  source_line_numbers?: number[];
  source_line_ids?: number[];
  group_id?: string;
  worksheet_description?: string;
  original_description?: string;
}

export interface TaxBreakdownData {
  worksheetNum: string;
  consigneeName: string;
  supplierName?: string;
  invoiceNumber?: string;
  shipmentReference?: string;
  currency?: string;
  invoiceTotal: number;
  freight: number;
  insurance: number;
  otherCharges: number;
  cifUSD: number;
  xr: number;
  cifTTD: number;
  rows: TaxBreakdownRow[];
  groupedRows?: TaxBreakdownRow[];
  sourceLines?: WorksheetSourceLine[];
  groupedLines?: WorksheetGroupedLine[];
  totalDuty: number;
  totalVAT: number;
  cesFee: number;
  depositFee: number;
  userFeeAmt: number;
  grandTotal: number;
  vatExempt?: boolean;
  preparedBy: string;
}

export interface Consignee {
  id: string;
  code: string;
  name: string;
  /** One or more emails, comma-separated */
  email: string;
  /** One or more WhatsApp/phone numbers, comma-separated */
  phone: string;
  address: string;
  updatedAt?: string;
}

export interface TaxLogAttachment {
  name: string;
  type: string;
  size?: string;
  auto?: boolean;
}

export type WorkflowStageStatus =
  | "not_started"
  | "in_progress"
  | "needs_review"
  | "complete"
  | "failed";

export type WorkflowStageId =
  | "upload"
  | "classification"
  | "taxes"
  | "worksheet"
  | "flowboard"
  | "asycuda";

export type InvoiceQueueStatus =
  | "extracting"
  | "classifying"
  | "needs_review"
  | "worksheet_ready"
  | "sent_to_flowboard";

export type FlowBoardQueueStatus =
  | "pending_send"
  /** Worksheet emailed/WhatsApp'd from Duty Desk without a FlowBoard card. */
  | "sent_via_email"
  | "sent"
  | "delivered"
  | "customer_viewed"
  | "awaiting_approval"
  | "approved"
  | "failed";

/** High-level lifecycle status of a Duty Desk customs job. */
export type DutyDeskJobStatus =
  | "draft"
  | "classification_in_progress"
  | "worksheet_ready"
  | "awaiting_completion"
  | "sending_to_flowboard"
  | "sent_to_flowboard"
  | "completed_directly"
  | "failed_flowboard_send";

/** How a completed worksheet is delivered/continued. */
export type DutyDeskJobType = "classification_only" | "brokerage_clearance";

export type MatchTypeLabel =
  | "Exact"
  | "Supplier Exact"
  | "Supplier Fuzzy"
  | "Learning Rules"
  | "Product Intelligence"
  | "AI Suggested"
  | "Manual Classification";

export interface TaxLogEntry {
  id: string;
  worksheetNum: string;
  consigneeName: string;
  billOfLading: string;
  commodity: string;
  totalDuty: number;
  totalVAT: number;
  depositFee: number;
  cesFee: number;
  userFeeAmt: number;
  grandTotal: number;
  sentTo: string;
  sentCc: string;
  sentBy: string;
  sentAt: string;
  method: string;
  attachments: TaxLogAttachment[];
  /** Flowboard kanban task id when opened via DutyDesk deep link */
  taskId?: string;
  /** Flowboard brokerage job id returned after worksheet send */
  flowboardJobId?: string;
  flowboardJobUrl?: string;
  flowboardWorksheetId?: string;
  flowboardReference?: string;
  flowboardStatus?: FlowBoardQueueStatus;
  lastSyncAt?: string;
  supplierName?: string;
  invoiceNumber?: string;
  lineItemCount?: number;
  totalCif?: number;
  syncError?: string;
  documentType?: "worksheet" | "brokerage_quote" | "tax_quote";
  /** Which completion path was taken for this job. */
  jobType?: DutyDeskJobType;
  /** High-level Duty Desk lifecycle status. */
  dutyDeskStatus?: DutyDeskJobStatus;
  /** Number of attachments included in the FlowBoard job package. */
  attachmentsSent?: number;
  /** Idempotency key used when sending to FlowBoard (prevents duplicate cards). */
  idempotencyKey?: string;
}

export interface ApprovedTaxItem {
  id: number;
  desc: string;
  tariff_code: string | null;
  duty_rate: string | null;
  qty: number;
  unit: string;
  price: number;
  itemCIF: number;
  originCode?: string;
}

export interface ApprovedTaxSheet {
  invId: number | null;
  combineAll: boolean;
  items: ApprovedTaxItem[];
  cifTTD: number;
  cifUSD: number;
  freight: number;
  insurance: number;
  xr: number;
  totalDuty: number;
  totalVat: number;
  consignee: Consignee | null;
}

export interface BrokerageInputs {
  cifUSD: string;
  paylessDiscount: "YES" | "NO";
  baseChargeOn: boolean;
  discount: string;
  discountPct: string;
  c26: string;
  c27: string;
  bdc: string;
  userFee: string;
  weighBridge: string;
  clerkOvertime: string;
  customsOvertime: string;
  certOrigin: string;
  custName: string;
  custCompany: string;
  custEmail: string;
  custPhone: string;
  custAddress: string;
  invoiceNo: string;
  commodity: string;
  preparedBy: string;
}

export interface ItemExemptions {
  dutyExempt?: boolean;
  vatExempt?: boolean;
}

/* ─── Step 19: Complex Invoice Line Parser & Product Identity ─── */

export type DescriptionTokenType =
  | "product_noun"
  | "brand"
  | "manufacturer"
  | "product_family"
  | "model"
  | "part_number"
  | "sku"
  | "catalogue_number"
  | "material"
  | "colour"
  | "finish"
  | "thickness"
  | "dimensions"
  | "capacity"
  | "voltage"
  | "power"
  | "concentration"
  | "grade"
  | "packaging"
  | "quantity"
  | "variant"
  | "marketing"
  | "unknown";

export interface DescriptionToken {
  text: string;
  type: DescriptionTokenType;
  start?: number;
  end?: number;
}

export interface ParsedDimensions {
  length: number | null;
  width: number | null;
  height?: number | null;
  unit: string | null;
  raw?: string | null;
}

export type ProductIdentityStatus = "resolved" | "partial" | "unresolved";

export interface ParsedLineDescription {
  rawDescription: string;
  brandOrProductFamily: string | null;
  productType: string | null;
  productNoun: string | null;
  thickness: string | null;
  styleOrFinish: string | null;
  colour: string[];
  partNumber: string | null;
  modelNumber: string | null;
  variant: string | null;
  dimensions: ParsedDimensions | null;
  sku: string | null;
  basePartNumber: string | null;
  variantSuffix: string | null;
  normalizedSku: string | null;
  material: string | null;
  function: string | null;
  packaging: string | null;
  grade: string | null;
  normalizedDescription: string | null;
  identityStatus: ProductIdentityStatus;
  identityConfidence: number;
  tokens: DescriptionToken[];
  unresolvedTokens: string[];
  missingFields: string[];
  suggestedQuestions: ProductQuestion[];
  resolutionSource?: string | null;
  catalogueMatchId?: number | null;
}

export interface AbbreviationDictionaryEntry {
  id: number;
  abbreviation: string;
  meaning: string;
  scope: "global" | "industry" | "supplier";
  industry_code: string | null;
  supplier_name: string | null;
  normalized_supplier: string | null;
  confidence: number;
  verified: boolean;
  status: string;
  usage_count?: number;
}

export interface SupplierCatalogueEntry {
  id: number;
  supplier_id: string | null;
  supplier_name: string;
  normalized_supplier: string;
  brand: string | null;
  supplier_sku: string | null;
  normalized_sku: string | null;
  base_part_number: string | null;
  manufacturer_part_number: string | null;
  product_name: string | null;
  product_type: string | null;
  full_description: string | null;
  material: string | null;
  composition: string | null;
  function_use: string | null;
  specifications_json: string | null;
  image_urls_json: string | null;
  approved_hs_code: string | null;
  duty_rate: string | null;
  approval_status: "pending" | "verified" | "rejected";
  source_document: string | null;
  last_verified_at: string | null;
  status: string;
  usage_count: number;
  created_at?: string;
  updated_at?: string;
}

export interface ProductIdentityLearningEntry {
  id: number;
  identity_key: string;
  supplier_name: string | null;
  brand: string | null;
  base_part_number: string | null;
  full_sku: string | null;
  product_family: string | null;
  product_type: string | null;
  material: string | null;
  function_use: string | null;
  specifications_json: string | null;
  approved_hs_code: string | null;
  duty_rate: string | null;
  approved: boolean;
  usage_count: number;
}

export interface LineContextSummary {
  supplierName: string | null;
  adjacentProductNouns: string[];
  sharedSkuPrefixes: string[];
  invoiceCategoryHints: string[];
  notes: string[];
}
