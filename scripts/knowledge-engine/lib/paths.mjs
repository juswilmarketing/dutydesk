import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, "../../..");

export const DIRS = {
  raw: path.join(ROOT, "knowledge", "raw", "explanatory-notes"),
  processed: path.join(ROOT, "knowledge", "processed", "explanatory-notes"),
  indexes: path.join(ROOT, "knowledge", "indexes", "explanatory-notes"),
};

export function chapterSlug(chapter) {
  return `chapter-${String(chapter).padStart(2, "0")}`;
}

export function chapterDir(chapter, kind = "processed") {
  const base = kind === "raw" ? DIRS.raw : kind === "indexes" ? DIRS.indexes : DIRS.processed;
  return path.join(base, chapterSlug(chapter));
}

export function ensureDirs() {
  for (const d of Object.values(DIRS)) fs.mkdirSync(d, { recursive: true });
}

export function loadEnvFile() {
  const envPath = path.join(ROOT, ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}
