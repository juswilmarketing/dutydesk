/**
 * Printer / printing machinery plugin → Chapter 84 / heading 8443.
 */

import type { PluginMatch, ProductFamilyPlugin } from "./types";

const FOOD = [
  "01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12", "13", "14",
  "15", "16", "17", "18", "19", "20", "21", "22", "23", "24",
];

const PRINTER =
  /\b(printers?|printing\s+machiner(?:y|ies)|laserjet|inkjet|thermo[\s-]?printer|label\s+printer|ticket\s+printer|receipt\s+printer)\b/i;

const CONSUMABLE =
  /\b(toner|ink\s*cartridge|ribbon\s*cartridge|printer\s*ribbon|ymck|ymcko)\b/i;

export const printerPlugin: ProductFamilyPlugin = {
  id: "printers",
  label: "Printers",
  match(rawDescription) {
    const raw = String(rawDescription || "").trim();
    if (!raw || !PRINTER.test(raw)) return null;
    if (CONSUMABLE.test(raw) && !/\bprinters?\b/i.test(raw)) return null;
    // Vision screener product that merely mentions print output stays medical
    if (/\bvision\s*screener\b/i.test(raw) && !/\bprinters?\b/i.test(raw)) return null;

    return {
      pluginId: "printers",
      confidence: 0.9,
      canonicalProduct: "printer",
      productNoun: "printer",
      productFamily: "printing machinery",
      industry: "office machinery",
      material: "",
      primaryFunction: "printing documents or images",
      intendedUse: "printing",
      physicalForm: "machine",
      finishedState: "finished article",
      partOrCompleteArticle: "complete article",
      brand: "",
      model: (raw.match(/\b(HVS[\s-]?\d+)\b/i)?.[1] || "").toUpperCase(),
      skuHints: [],
      dimensions: {},
      technicalSpecifications: {
        accessoryFor: /\bfor\s+hvs|\bhvs[\s-]?\d+\b/i.test(raw) ? "HVS vision screener" : null,
      },
      likelyChapters: ["84"],
      excludedChapters: [...FOOD, "90", "38", "34", "39", "63", "87", "94", "85"],
      preferredHeadings: ["8443", "844332", "844339"],
      prohibitedHeadings: ["9018", "3808", "3822", "8471"],
      missingCriticalAttributes: [],
      searchTerms: ["printers", "printing machinery", "other", "automatic data processing"],
      administrativeCodes: [],
      notes: [
        "Product noun is the printer. Accessory use with medical equipment does not move it to Chapter 90.",
      ],
    } satisfies PluginMatch;
  },
  scoreCandidate(_match, candidate) {
    const supporting: string[] = [];
    const conflicts: string[] = [];
    let delta = 0;
    const codeDigits = candidate.code.replace(/\D/g, "");
    const desc = candidate.description.toLowerCase();
    const ch = candidate.chapter.padStart(2, "0");

    if (codeDigits.startsWith("8443")) {
      delta += 40;
      supporting.push("Printing machinery heading 8443");
    }
    if (codeDigits.startsWith("844332")) {
      delta += 15;
      supporting.push("ADP-connectable printer line");
    }
    if (codeDigits.startsWith("844339")) {
      delta += 10;
      supporting.push("Other printers");
    }
    if (ch === "90" || codeDigits.startsWith("9018")) {
      delta -= 40;
      conflicts.push("Printer is classified as printing machinery, not the medical instrument");
    }
    if (["38", "34", "39", "63", "87", "94"].includes(ch)) {
      delta -= 100;
      conflicts.push(`Chapter ${ch} incompatible with printer`);
    }
    if (/malaria|insecticide|mosquito|zika|reagent|diagnostic kit/i.test(desc)) {
      delta -= 100;
      conflicts.push("Chemical/diagnostic preparation is not a printer");
    }
    if (/offset|flexographic|gravure/i.test(desc) && !/other/i.test(desc)) {
      delta -= 15;
      conflicts.push("Industrial press line less likely for desk accessory printer");
    }
    return { delta, supporting, conflicts };
  },
};
