import {
  commonProductEntryFromRule,
  type CommonProductEntry,
} from "@pas/product-intelligence";

type D1Like = {
  prepare: (sql: string) => {
    all: () => Promise<{ results?: Record<string, unknown>[] }>;
  };
};

/** Load active product_family_rules for the common-product fast path (admin overrides). */
export async function loadCommonProductEntriesFromDb(db: D1Like): Promise<CommonProductEntry[]> {
  try {
    const rows = await db
      .prepare(
        `SELECT canonical_product, alias, product_family, likely_chapters, likely_headings,
                required_attributes, prohibited_chapters, priority
         FROM product_family_rules
         WHERE active = 1
         ORDER BY priority ASC, id ASC
         LIMIT 2000`,
      )
      .all();
    return (rows.results || []).map((r) =>
      commonProductEntryFromRule({
        canonical_product: String(r.canonical_product || ""),
        alias: String(r.alias || ""),
        product_family: String(r.product_family || ""),
        likely_chapters: String(r.likely_chapters || "[]"),
        likely_headings: String(r.likely_headings || "[]"),
        required_attributes: String(r.required_attributes || "[]"),
        prohibited_chapters: String(r.prohibited_chapters || "[]"),
        priority: Number(r.priority || 100),
      }),
    );
  } catch {
    // Table may not exist until migration 0020 is applied
    return [];
  }
}
