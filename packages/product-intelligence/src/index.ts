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
