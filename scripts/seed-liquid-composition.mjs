/**
 * Seed Liquid Composition Rules into D1.
 * Usage: npm run seed:liquid-composition -- --remote
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SEED = path.join(ROOT, "packages", "product-intelligence", "seed", "liquid-composition-rules.json");
const remote = process.argv.includes("--remote");

function esc(s) {
  return String(s ?? "").replace(/'/g, "''");
}

const rules = JSON.parse(fs.readFileSync(SEED, "utf8"));
const lines = [];
lines.push("DELETE FROM liquid_composition_rules;");

for (const r of rules) {
  lines.push(
    `INSERT INTO liquid_composition_rules (liquid_type, display_name, typical_chapters, required_fields, composition_thresholds, active_ingredient_mappings, solvent_base_mappings, chemical_synonyms, cas_mappings, classification_hints, status) VALUES ('${esc(r.liquid_type)}', '${esc(r.display_name)}', '${esc(JSON.stringify(r.typical_chapters ?? []))}', '${esc(JSON.stringify(r.required_fields ?? []))}', '${esc(JSON.stringify(r.composition_thresholds ?? []))}', '${esc(JSON.stringify(r.active_ingredient_mappings ?? []))}', '${esc(JSON.stringify(r.solvent_base_mappings ?? []))}', '${esc(JSON.stringify(r.chemical_synonyms ?? []))}', '${esc(JSON.stringify(r.cas_mappings ?? []))}', '${esc(JSON.stringify(r.classification_hints ?? []))}', 'active');`,
  );
}

const tmp = path.join(ROOT, ".tmp-seed-liquid-composition.sql");
fs.writeFileSync(tmp, lines.join("\n"), "utf8");
const flag = remote ? "--remote" : "--local";
console.log(`Seeding liquid composition rules (${remote ? "remote" : "local"})…`);
execSync(`npx wrangler d1 execute pas-trinidad ${flag} --file="${tmp}"`, {
  cwd: ROOT,
  stdio: "inherit",
});
fs.unlinkSync(tmp);
console.log("Seed complete.");
