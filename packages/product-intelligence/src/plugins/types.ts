/**
 * Product-family plugin contracts.
 * Plugins narrow chapters and improve parsing; they never invent tariff codes.
 */

export type PluginMatch = {
  pluginId: string;
  confidence: number;
  canonicalProduct: string;
  productNoun: string;
  productFamily: string;
  industry: string;
  material: string;
  primaryFunction: string;
  intendedUse: string;
  physicalForm: string;
  finishedState: string;
  partOrCompleteArticle: string;
  brand: string;
  model: string;
  skuHints: string[];
  dimensions: Record<string, string | number | boolean | null>;
  technicalSpecifications: Record<string, string | number | boolean | null>;
  likelyChapters: string[];
  excludedChapters: string[];
  /** Preferred headings (4–6 digit) for retrieval bias — not final codes. */
  preferredHeadings: string[];
  prohibitedHeadings: string[];
  missingCriticalAttributes: string[];
  searchTerms: string[];
  /** Tokens that must NOT dominate tariff text similarity. */
  administrativeCodes: string[];
  notes: string[];
};

export type ProductFamilyPlugin = {
  id: string;
  label: string;
  /** Return a match when this family applies; null otherwise. */
  match(rawDescription: string, context?: { supplier?: string | null }): PluginMatch | null;
  /** Optional extra scoring hints for a retrieved tariff line description. */
  scoreCandidate?(
    match: PluginMatch,
    candidate: { code: string; description: string; chapter: string; heading: string },
  ): { delta: number; supporting: string[]; conflicts: string[] };
};
