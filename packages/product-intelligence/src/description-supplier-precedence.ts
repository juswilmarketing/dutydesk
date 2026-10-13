import { findProductFamily } from "./product-families";
import { matchProductNounLexicon, type NounLexiconEntry } from "./product-noun-lexicon";
import type { CommonProductMatch } from "./common-product-dictionary";
import type { PluginMatch } from "./plugins/types";

/** Identity read only from the invoice line (common product, plugin, rule, or lexicon). */
export type InvoiceLineIdentity = {
  family: string;
  industry: string;
  canonical: string;
  noun: string;
  likelyChapters: string[];
  confidence: number;
};

export const MIN_INVOICE_IDENTITY_CONFIDENCE = 0.7;

type RuleLike = {
  canonical: string;
  noun: string;
  family: string;
  industry: string;
  likelyChapters: string[];
  confidence: number;
};

export function invoiceLineIdentity(input: {
  common: CommonProductMatch | null;
  plugin: PluginMatch | null;
  rule: RuleLike | null;
  lexicon: NounLexiconEntry | null;
}): InvoiceLineIdentity | null {
  if (input.common) {
    return {
      family: input.common.productFamily,
      industry: input.common.industry,
      canonical: input.common.canonicalProduct,
      noun: input.common.productNoun,
      likelyChapters: input.common.likelyChapters,
      confidence: input.common.confidence,
    };
  }
  if (input.plugin) {
    return {
      family: input.plugin.productFamily,
      industry: input.plugin.industry,
      canonical: input.plugin.canonicalProduct,
      noun: input.plugin.productNoun,
      likelyChapters: input.plugin.likelyChapters,
      confidence: input.plugin.confidence,
    };
  }
  if (input.rule) {
    return {
      family: input.rule.family,
      industry: input.rule.industry,
      canonical: input.rule.canonical,
      noun: input.rule.noun,
      likelyChapters: input.rule.likelyChapters,
      confidence: input.rule.confidence,
    };
  }
  if (input.lexicon) {
    return {
      family: input.lexicon.family,
      industry: input.lexicon.industry,
      canonical: input.lexicon.canonical,
      noun: input.lexicon.noun,
      likelyChapters: input.lexicon.likelyChapters,
      confidence: input.lexicon.confidence,
    };
  }
  return null;
}

function normalizeFamily(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "_");
}

function identityFromSupplierLabel(label: string): InvoiceLineIdentity | null {
  const trimmed = label.trim();
  if (!trimmed) return null;
  const lex = matchProductNounLexicon(trimmed);
  if (lex) {
    return {
      family: lex.family,
      industry: lex.industry,
      canonical: lex.canonical,
      noun: lex.noun,
      likelyChapters: lex.likelyChapters,
      confidence: lex.confidence,
    };
  }
  const family = findProductFamily(trimmed, { canonicalProduct: trimmed });
  if (family) {
    return {
      family: family.id,
      industry: family.label,
      canonical: trimmed,
      noun: family.aliases[0] || trimmed,
      likelyChapters: family.likelyChapters,
      confidence: family.confidence,
    };
  }
  return null;
}

function chaptersCompatible(a: string[], b: string[]): boolean {
  if (!a.length || !b.length) return true;
  return a.some((chapter) => b.includes(chapter));
}

export function lineIdentitiesConflict(
  invoice: InvoiceLineIdentity,
  supplier: InvoiceLineIdentity,
): boolean {
  const invoiceFamily = normalizeFamily(invoice.family);
  const supplierFamily = normalizeFamily(supplier.family);
  if (invoiceFamily && supplierFamily && invoiceFamily !== supplierFamily) {
    return true;
  }
  if (!chaptersCompatible(invoice.likelyChapters, supplier.likelyChapters)) {
    return true;
  }
  return false;
}

/**
 * Prefer the invoice description over supplier/catalogue labels when the line
 * identifies a product clearly and the supplier label points elsewhere.
 */
export function supplierEvidenceConflictsWithDescription(
  rawDescription: string,
  invoiceLine: InvoiceLineIdentity | null,
  evidenceCanonical: string | undefined,
): boolean {
  const evidence = evidenceCanonical?.trim();
  if (!evidence || !invoiceLine || invoiceLine.confidence < MIN_INVOICE_IDENTITY_CONFIDENCE) {
    return false;
  }

  const raw = rawDescription.toLowerCase();
  const evLower = evidence.toLowerCase();
  if (evLower.length >= 4 && raw.includes(evLower)) {
    return false;
  }

  const supplier = identityFromSupplierLabel(evidence);
  if (!supplier) return false;

  return lineIdentitiesConflict(invoiceLine, supplier);
}
