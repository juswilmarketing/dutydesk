/**
 * Seed Product Intelligence dictionaries into D1.
 * Usage: npm run seed:product-intelligence -- --remote
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SEED = path.join(ROOT, "packages", "product-intelligence", "seed");
const remote = process.argv.includes("--remote");

function esc(s) {
  return String(s ?? "").replace(/'/g, "''");
}

function load(name) {
  return JSON.parse(fs.readFileSync(path.join(SEED, name), "utf8"));
}

const industries = load("industries.json");
const products = load("products.json");
const brands = load("brands.json");
const questionRules = load("question-rules.json");
const chapterRules = load("chapter-rules.json");

const lines = [];
lines.push("DELETE FROM chapter_prediction_rules;");
lines.push("DELETE FROM question_rules;");
lines.push("DELETE FROM brand_dictionary;");
lines.push("DELETE FROM product_dictionary;");
lines.push("DELETE FROM industry_dictionary;");

for (const i of industries) {
  lines.push(
    `INSERT INTO industry_dictionary (code, name, description, typical_chapters, status) VALUES ('${esc(i.code)}', '${esc(i.name)}', '${esc(i.description)}', '${esc(JSON.stringify(i.typical_chapters))}', 'active');`,
  );
}

for (const p of products) {
  const key = p.canonical_name.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  lines.push(
    `INSERT INTO product_dictionary (canonical_name, normalized_key, synonyms, product_family, industry_code, typical_chapter, common_materials, typical_uses, status) VALUES ('${esc(p.canonical_name)}', '${esc(key)}', '${esc(JSON.stringify(p.synonyms))}', '${esc(p.product_family)}', '${esc(p.industry_code)}', '${esc(p.typical_chapter)}', '${esc(JSON.stringify(p.common_materials))}', '${esc(JSON.stringify(p.typical_uses))}', 'active');`,
  );
}

for (const b of brands) {
  const nb = b.brand.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  lines.push(
    `INSERT INTO brand_dictionary (brand, normalized_brand, industry_hints, typical_chapters, confidence_boost, status) VALUES ('${esc(b.brand)}', '${esc(nb)}', '${esc(JSON.stringify(b.industry_hints))}', '${esc(JSON.stringify(b.typical_chapters))}', ${b.confidence_boost}, 'active');`,
  );
}

for (const q of questionRules) {
  lines.push(
    `INSERT INTO question_rules (industry_code, product_family, questions_json, priority, status) VALUES (${q.industry_code ? `'${esc(q.industry_code)}'` : "NULL"}, ${q.product_family ? `'${esc(q.product_family)}'` : "NULL"}, '${esc(JSON.stringify(q.questions))}', ${q.priority}, 'active');`,
  );
}

for (const r of chapterRules) {
  lines.push(
    `INSERT INTO chapter_prediction_rules (industry_code, product_family, material, function_key, chapter, weight, status) VALUES (${r.industry_code ? `'${esc(r.industry_code)}'` : "NULL"}, ${r.product_family ? `'${esc(r.product_family)}'` : "NULL"}, ${r.material ? `'${esc(r.material)}'` : "NULL"}, ${r.function_key ? `'${esc(r.function_key)}'` : "NULL"}, '${esc(r.chapter)}', ${r.weight}, 'active');`,
  );
}

const tmp = path.join(ROOT, ".tmp-seed-product-intelligence.sql");
fs.writeFileSync(tmp, lines.join("\n"), "utf8");
const flag = remote ? "--remote" : "--local";
console.log(`Seeding product intelligence (${remote ? "remote" : "local"})…`);
execSync(`npx wrangler d1 execute pas-trinidad ${flag} --file="${tmp}"`, {
  cwd: ROOT,
  stdio: "inherit",
});
fs.unlinkSync(tmp);
console.log("Seed complete.");
