import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const src = process.argv[2] || join(process.env.USERPROFILE || "", "Downloads/pas-cloudflare-polished-extracted/tt_tariff_data.js");
const outDir = join(root, "packages/tariff-data/data");
mkdirSync(outDir, { recursive: true });

const raw = readFileSync(src, "utf8");
const match = raw.match(/const TT_TARIFF = (\[[\s\S]*\]);/);
if (!match) throw new Error("Could not parse TT_TARIFF from source file");

const tariff = eval(match[1]);
const json = tariff.map(([code, desc, duty]) => ({ code, desc, duty }));
writeFileSync(join(outDir, "tariff.json"), JSON.stringify(json));
console.log(`Wrote ${json.length} tariff entries to packages/tariff-data/data/tariff.json`);
