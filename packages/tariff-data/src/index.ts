export {
  getTariffCount,
  getTariffRows,
  catFromCode,
  searchTariff,
  similarCodes,
  normalizeDesc,
  learnedMatch,
  bestMatch,
  hasTokenMatch,
  scoreTariffDescription,
  TT_TARIFF,
} from "./search";
export type { TariffRow, LearnedLookup } from "./search";
export {
  normalizeSupplierName,
  extractPartNumbers,
  buildSupplierLookupIndex,
  supplierExactMatch,
  supplierFuzzyMatch,
  classifyCascade,
  FUZZY_AUTO_THRESHOLD,
  FUZZY_SUGGEST_THRESHOLD,
} from "./supplier-search";
export type {
  SupplierHistoryRow,
  SupplierLookupIndex,
  SupplierMatchResult,
  ClassifyCascadeResult,
  ClassifyCascadeInput,
} from "./supplier-search";
