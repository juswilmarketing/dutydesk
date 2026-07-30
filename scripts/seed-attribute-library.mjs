/**
 * Seed Product Attribute Library into D1.
 * Usage: npm run seed:attribute-library -- --remote
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SEED = path.join(ROOT, "packages", "product-intelligence", "seed", "attribute-library.json");
const remote = process.argv.includes("--remote");

function esc(s) {
  return String(s ?? "").replace(/'/g, "''");
}

const profiles = JSON.parse(fs.readFileSync(SEED, "utf8"));
const lines = [];
lines.push("DELETE FROM product_attribute_library;");

for (const p of profiles) {
  lines.push(
    `INSERT INTO product_attribute_library (product_family, industry, typical_chapters, required_attributes, optional_attributes, question_order, validation_rules, status) VALUES ('${esc(p.productFamily)}', '${esc(p.industry)}', '${esc(JSON.stringify(p.typicalChapters ?? []))}', '${esc(JSON.stringify(p.requiredAttributes ?? []))}', '${esc(JSON.stringify(p.optionalAttributes ?? []))}', '${esc(JSON.stringify(p.questionOrder ?? []))}', '${esc(JSON.stringify(p.validationRules ?? []))}', 'active');`,
  );
}

const tmp = path.join(ROOT, ".tmp-seed-attribute-library.sql");
fs.writeFileSync(tmp, lines.join("\n"), "utf8");
const flag = remote ? "--remote" : "--local";
console.log(`Seeding attribute library (${remote ? "remote" : "local"})…`);
execSync(`npx wrangler d1 execute pas-trinidad ${flag} --file="${tmp}"`, {
  cwd: ROOT,
  stdio: "inherit",
});
fs.unlinkSync(tmp);
console.log("Seed complete.");
