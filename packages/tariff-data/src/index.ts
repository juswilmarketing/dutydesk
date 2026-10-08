export {
  getTariffCount,
  getTariffRows,
  TT_TARIFF,
} from "./rows";
export type { TariffRow } from "./rows";
export {
  catFromCode,
  searchTariff,
  similarCodes,
  normalizeDesc,
  learnedMatch,
  bestMatch,
  hasTokenMatch,
  scoreTariffDescription,
} from "./search";
export type { LearnedLookup } from "./search";
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
export {
  digitsOnly,
  normalizeTariffCode,
  parseTariffCode,
  chapterFromCode,
  headingFromCode,
  nationalFromCode,
} from "./code";
export type { ParsedTariffCode } from "./code";
export { CHAPTER_TITLES, chapterTitle } from "./chapter-titles";
export {
  getHierarchyIndex,
  getNationalLine,
  getChapter,
  getHeading,
  getNationalLinesForHeading,
  getNationalLinesForChapter,
  listChapters,
  scoreChapter,
  searchHeadingsInChapters,
  searchNationalInHeadings,
  buildTariffHealthReport,
} from "./hierarchy";
export type {
  TariffChapterNode,
  TariffHeadingNode,
  TariffHealthIssue,
  TariffHealthReport,
} from "./hierarchy";
