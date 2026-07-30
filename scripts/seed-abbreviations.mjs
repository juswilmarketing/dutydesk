/**
 * Seed abbreviation dictionary into D1.
 * Usage: npm run seed:abbreviations -- --remote
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SEED = path.join(ROOT, "packages", "product-intelligence", "seed", "abbreviations.json");
const remote = process.argv.includes("--remote");

function esc(s) {
  return String(s ?? "").replace(/'/g, "''");
}

const rows = JSON.parse(fs.readFileSync(SEED, "utf8"));
const lines = [];
lines.push("DELETE FROM abbreviation_dictionary;");

for (const a of rows) {
  lines.push(
    `INSERT INTO abbreviation_dictionary (abbreviation, meaning, scope, industry_code, confidence, verified, status) VALUES ('${esc(a.abbreviation)}', '${esc(a.meaning)}', '${esc(a.scope || "global")}', ${a.industry_code ? `'${esc(a.industry_code)}'` : "NULL"}, ${Number(a.confidence ?? 0.8)}, ${a.verified ? 1 : 0}, 'active');`,
  );
}

const tmp = path.join(ROOT, ".tmp-seed-abbreviations.sql");
fs.writeFileSync(tmp, lines.join("\n"), "utf8");
const flag = remote ? "--remote" : "--local";
console.log(`Seeding abbreviations (${remote ? "remote" : "local"})…`);
execSync(`npx wrangler d1 execute pas-trinidad ${flag} --file="${tmp}"`, {
  cwd: ROOT,
  stdio: "inherit",
});
fs.unlinkSync(tmp);
console.log("Seed complete.");
