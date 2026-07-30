import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const rows = JSON.parse(
  readFileSync(resolve(root, "packages/tariff-data/data/tariff.json"), "utf8"),
);
const remote = process.argv.includes("--remote");
const chunkSize = 200;

function sql(value) {
  return `'${String(value ?? "").replaceAll("'", "''")}'`;
}

const statements = [];
for (let offset = 0; offset < rows.length; offset += chunkSize) {
  const values = rows.slice(offset, offset + chunkSize).map((row) => {
    const normalized = String(row.code || "").replace(/[^0-9]/g, "");
    return `(${sql(row.code)},${sql(normalized)},${sql(row.desc)},${sql(row.duty)},'bundled_snapshot')`;
  }).join(",");
  statements.push(`INSERT INTO ttbizlink_tariffs
    (code, normalized_code, description, duty_rate, source)
   VALUES ${values}
   ON CONFLICT(code) DO UPDATE SET
     normalized_code = excluded.normalized_code,
     description = CASE WHEN ttbizlink_tariffs.source = 'ttbizlink'
       THEN ttbizlink_tariffs.description ELSE excluded.description END,
     duty_rate = CASE WHEN ttbizlink_tariffs.source = 'ttbizlink'
       THEN ttbizlink_tariffs.duty_rate ELSE excluded.duty_rate END,
     updated_at = datetime('now');`);
}

const seedFile = resolve(root, ".tmp-ttbizlink-seed.sql");
writeFileSync(seedFile, statements.join("\n"), "utf8");
try {
  const args = [
    "wrangler",
    "d1",
    "execute",
    "pas-trinidad",
    remote ? "--remote" : "--local",
    "--file",
    seedFile,
  ];
  const result = spawnSync("npx", args, {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
} finally {
  unlinkSync(seedFile);
}

process.stdout.write(`Stored ${rows.length} tariff codes in the ${remote ? "remote" : "local"} cache.\n`);
