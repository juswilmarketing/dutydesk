export { normalizeKey, applyPhraseNormalization, tokenize } from "./normalize";
export { extractAttributes } from "./attribute-extract";
export {
  loadSeedDictionaries,
  matchProduct,
  matchBrand,
  industryByCode,
  type DictionaryBundle,
} from "./dictionaries";
export { buildProductProfile, selectQuestions } from "./profile-builder";
export { predictChapter, predictHeadings, predictHeadingsGlobal, buildPrediction } from "./predict";
export {
  detectProductDomain,
  domainTariffConflict,
  isFoodChapter,
  DOMAIN_LABELS,
  type ProductDomain,
  type DomainSignal,
} from "./domain";
export {
  runProductIntelligence,
  type ProductIntelligenceInput,
  type ProductIntelligenceResult,
} from "./pipeline";
export {
  loadSeedAttributeLibrary,
  resolveAttributeProfile,
  runAttributeEngine,
  buildLearningKey,
  type AttributeLibraryBundle,
  type AttributeEngineInput,
  type AttributeEngineResult,
} from "./attribute-engine";
export {
  isLikelyLiquid,
  loadSeedLiquidRules,
  extractCompositionFromText,
  runLiquidCompositionEngine,
  compactLiquidForAi,
  buildLiquidIdentityKey,
  type LiquidEngineInput,
  type LiquidEngineResult,
} from "./liquid-engine";
export { parseInvoiceLineDescription, applyClerkIdentityAnswers } from "./line-parser";
export {
  parseEvidenceDescription,
  normalizeEvidenceSearch,
  normalizeProductCode,
} from "./evidence-parser";
export {
  stripIdentifierNoise,
  normalizeIdentifierVariants,
  splitSkuVariant,
  identifiersMatch,
} from "./sku-normalize";
export {
  resolveProductIdentity,
  buildProductIdentityKey,
  type IdentityResolverInput,
  type IdentityResolverResult,
} from "./identity-resolver";
export {
  buildProductClassificationProfile,
  profileSearchQuery,
  type ProductClassificationProfile,
} from "./classification-profile";
export {
  classifyHierarchically,
  constrainAiSelection,
  candidateDutyRate,
  type HierarchicalClassificationResult,
  type ScoredCandidate,
  type ScoredChapter,
} from "./hierarchical-classifier";
export {
  detectInvoiceLineType,
  isNonMerchandiseLine,
  chargeKindFromLineType,
  type InvoiceLineType,
  type LineTypeResult,
} from "./line-type";
export {
  groupInvoiceRows,
  type RawExtractedRow,
  type GroupedMerchandiseLine,
  type GroupedChargeLine,
  type InvoiceGroupingResult,
} from "./line-grouping";
export {
  tokenizeForClassification,
  semanticSearchText,
  extractAdministrativeCodes,
  type WeightedToken,
  type TokenRole,
} from "./token-roles";
export {
  matchProductFamilyPlugin,
  getPluginById,
  PRODUCT_FAMILY_PLUGINS,
  type ProductFamilyPlugin,
  type PluginMatch,
} from "./plugins";
export {
  needsSupplierSearch,
  buildSupplierSearchQueries,
  compactEvidenceForAi,
  evidenceFromInternalMatch,
  extractProductEvidenceFromText,
  getSupplierProfile,
  normalizeSupplierKey,
  SUPPLIER_SEARCH_LIMITS,
  type StructuredProductEvidence,
  type SupplierEvidenceSourceType,
  type SupplierProfile,
} from "./supplier-search";
export { CUSTOMER_INDUSTRY_WEIGHT_MAX } from "./classification-profile";
export { isPackagingContainerDescription, packagingPlugin } from "./plugins/packaging";
export {
  matchProductNounLexicon,
  PRODUCT_NOUN_LEXICON,
  type NounLexiconEntry,
} from "./product-noun-lexicon";
export {
  resolveCommonProduct,
  commonProductEntryFromRule,
  COMMON_PRODUCT_DICTIONARY,
  type CommonProductMatch,
  type CommonProductEntry,
} from "./common-product-dictionary";
export {
  PRODUCT_FAMILY_REGISTRY,
  findProductFamily,
  getFamilyById,
  type ProductFamilyDefinition,
  type FamilyQuestion,
} from "./product-families";
export {
  routeProductFamily,
  applyFamilyRouteToProfile,
  type FamilyRouteResult,
} from "./product-family-router";
export {
  scoreCandidateCompatibility,
  filterCompatibleCandidates,
  type CompatibilityResult,
} from "./candidate-compatibility";
