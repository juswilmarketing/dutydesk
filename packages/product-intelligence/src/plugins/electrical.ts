/**
 * Electrical product-family plugin (wall switches, etc.).
 */

import type { PluginMatch, ProductFamilyPlugin } from "./types";

const FOOD = [
  "01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12", "13", "14",
  "15", "16", "17", "18", "19", "20", "21", "22", "23", "24",
];

const WALL_SWITCH =
  /\b(smart\s+)?wall\s*(touch\s*)?(light\s*)?switch\b|\btouch\s+light\s+switch\b|\bwall\s+switch\b|\b(\d)\s*gang\b.*\bswitch\b|\bswitch\b.*\b(\d)\s*gang\b/i;

export const electricalPlugin: ProductFamilyPlugin = {
  id: "electrical",
  label: "Electrical",
  match(rawDescription) {
    const raw = String(rawDescription || "").trim();
    if (!raw || !WALL_SWITCH.test(raw)) return null;

    const gang = raw.match(/\b(\d)\s*gang\b/i);
    const gangCount = gang ? Number(gang[1]) : null;
    const wifi = /\bwi-?fi|2\.4\s*ghz|alexa|smart\b/i.test(raw);

    return {
      pluginId: "electrical",
      confidence: 0.9,
      canonicalProduct: "wall-mounted electrical light switch",
      productNoun: "switch",
      productFamily: "electrical apparatus for switching",
      industry: "electrical",
      material: /\bglass\b/i.test(raw) ? "glass panel (housing)" : "",
      primaryFunction: "switching an electrical lighting circuit",
      intendedUse: "building electrical installation",
      physicalForm: "wall-mounted switch",
      finishedState: "finished article",
      partOrCompleteArticle: "complete article",
      brand: "",
      model: "",
      skuHints: [],
      dimensions: { gangCount },
      technicalSpecifications: {
        technology: wifi ? "touch control; Wi-Fi remote control" : "wall switch",
        installation: "wall mounted",
        gangCount,
        voltage: "unknown",
      },
      likelyChapters: ["85"],
      excludedChapters: [...FOOD, "70", "94", "84", "90", "63"],
      preferredHeadings: ["853650", "8536"],
      prohibitedHeadings: ["8517", "9405", "7013", "8471", "8525"],
      missingCriticalAttributes: [],
      searchTerms: ["switches", "apparatus for switching", "electrical circuits", "wall"],
      administrativeCodes: [],
      notes: [
        "Primary function is electrical switching; Wi-Fi/Alexa are secondary control features.",
        "Do not classify as telecom apparatus, lamp, glassware, or computer accessory.",
      ],
    } satisfies PluginMatch;
  },
  scoreCandidate(_match, candidate) {
    const supporting: string[] = [];
    const conflicts: string[] = [];
    let delta = 0;
    const heading = candidate.heading.replace(/\D/g, "");
    const desc = candidate.description.toLowerCase();
    const codeDigits = candidate.code.replace(/\D/g, "");

    if (codeDigits.startsWith("853650") || heading.startsWith("8536")) {
      delta += 40;
      supporting.push("Electrical switching apparatus heading family 8536.50");
    }
    if (codeDigits.startsWith("8517") || /telephone|telecom|transmission/i.test(desc)) {
      delta -= 90;
      conflicts.push("Telecommunications apparatus is not the principal function");
    }
    if (codeDigits.startsWith("9405") || /lamp|lighting fitting|chandelier/i.test(desc)) {
      delta -= 90;
      conflicts.push("Not a lamp or lighting fitting");
    }
    if (codeDigits.startsWith("7013") || (/glass/i.test(desc) && candidate.chapter === "70")) {
      delta -= 80;
      conflicts.push("Glass panel is incidental; not a glass article of Chapter 70");
    }
    if (codeDigits.startsWith("8471") || /automatic data processing|computer/i.test(desc)) {
      delta -= 80;
      conflicts.push("Not a computer accessory");
    }
    if (/switch/i.test(desc)) {
      delta += 15;
      supporting.push("Tariff description mentions switches");
    }
    return { delta, supporting, conflicts };
  },
};
