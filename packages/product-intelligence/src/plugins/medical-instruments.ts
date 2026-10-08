/**
 * Medical / ophthalmic instrument plugin.
 * Vision screeners and eye-exam equipment → Chapter 90 / heading 9018.
 */

import type { PluginMatch, ProductFamilyPlugin } from "./types";

const FOOD = [
  "01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12", "13", "14",
  "15", "16", "17", "18", "19", "20", "21", "22", "23", "24",
];

const VISION_SCREENER =
  /\b(vision\s*screener|eye\s*screener|visual\s*screener|photoscreener|auto[\s-]?refractor|autorefractor|slit\s*lamp|ophthalmoscope|retinoscop|tonometer|keratometer|fundus\s*camera|pachymeter|perimeter|phoropter|lensmeter|lensometer)\b/i;

const OPHTHALMIC =
  /\b(ophthalmic|ophthalmol|optometr|eye[\s-]?exam|ocular\s*(device|instrument|equipment)|huvitz|topcon\s*ophthal|nidek)\b/i;

const MEDICAL_INSTRUMENT =
  /\b(ultrasound\s*scanner|ultrasonic\s*scanning|mri\s*apparatus|magnetic\s*resonance|electrocardiograph|ecg\s*machine|patient\s*monitor)\b/i;

export const medicalInstrumentsPlugin: ProductFamilyPlugin = {
  id: "medical_instruments",
  label: "Medical instruments",
  match(rawDescription, context) {
    const raw = String(rawDescription || "").trim();
    if (!raw) return null;

    // Dedicated accessory printers are handled by the printer plugin
    if (/\bprinters?\b/i.test(raw) && !VISION_SCREENER.test(raw) && !MEDICAL_INSTRUMENT.test(raw)) {
      return null;
    }

    const vision = VISION_SCREENER.test(raw);
    const ophthalmic = OPHTHALMIC.test(raw) || /ophthalmic/i.test(String(context?.supplier || ""));
    const medicalInstr = MEDICAL_INSTRUMENT.test(raw);

    if (!vision && !(ophthalmic && /\b(instrument|appliance|device|equipment|screener|camera|scope)\b/i.test(raw)) && !medicalInstr) {
      // Supplier-only ophthalmic hint is too weak without a device noun
      if (!(ophthalmic && /\b(hvs[\s-]?\d|serial\s*number)/i.test(raw))) return null;
    }

    const canonical = vision
      ? "ophthalmic vision screener"
      : medicalInstr
        ? "medical diagnostic instrument"
        : "ophthalmic instrument";

    return {
      pluginId: "medical_instruments",
      confidence: vision ? 0.93 : 0.88,
      canonicalProduct: canonical,
      productNoun: vision ? "vision screener" : "medical instrument",
      productFamily: "medical / ophthalmic instruments",
      industry: "medical",
      material: "",
      primaryFunction: vision
        ? "vision screening / ophthalmic examination"
        : "medical diagnosis or examination",
      intendedUse: "medical / clinical",
      physicalForm: "instrument / appliance",
      finishedState: "finished article",
      partOrCompleteArticle: "complete article",
      brand: /\bhuvitz\b/i.test(raw) ? "Huvitz" : "",
      model: (raw.match(/\b(HVS[\s-]?\d+)\b/i)?.[1] || "").toUpperCase(),
      skuHints: [],
      dimensions: {},
      technicalSpecifications: {
        domain: vision || ophthalmic ? "ophthalmic" : "medical diagnostic",
      },
      likelyChapters: ["90"],
      excludedChapters: [...FOOD, "39", "40", "63", "73", "84", "85", "87", "94", "34", "38"],
      preferredHeadings: vision || ophthalmic ? ["901850", "9018"] : ["9018", "901819"],
      prohibitedHeadings: ["8443", "8471", "8525", "9013", "3808", "3822"],
      missingCriticalAttributes: [],
      searchTerms: vision || ophthalmic
        ? ["ophthalmic instruments", "appliances", "other ophthalmic"]
        : ["instruments", "appliances", "medical", "electro-diagnostic"],
      administrativeCodes: [],
      notes: [
        "Classify the instrument itself under Chapter 90 — not plastics, chemicals, or printers.",
        "Vision screeners are ophthalmic instruments (typically heading 9018.50).",
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

    if (ch === "90") {
      delta += 25;
      supporting.push("Chapter 90 medical/optical instruments");
    }
    if (codeDigits.startsWith("901850")) {
      delta += 45;
      supporting.push("Other ophthalmic instruments and appliances (9018.50)");
    } else if (codeDigits.startsWith("9018")) {
      delta += 30;
      supporting.push("Medical instruments heading 9018");
    }
    if (/ophthalmic/i.test(desc)) {
      delta += 20;
      supporting.push("Tariff description is ophthalmic");
    }
    if (["39", "38", "34", "63", "87", "94"].includes(ch)) {
      delta -= 100;
      conflicts.push(`Chapter ${ch} incompatible with medical/ophthalmic instrument`);
    }
    if (codeDigits.startsWith("8443") || codeDigits.startsWith("3808") || codeDigits.startsWith("3822")) {
      delta -= 90;
      conflicts.push("Printer/chemical heading is not the vision screener");
    }
    if (/malaria|insecticide|mosquito|polyacetal|plastic/i.test(desc) && !/ophthalmic|instrument/i.test(desc)) {
      delta -= 80;
      conflicts.push("Unrelated chemical/plastic tariff line");
    }
    return { delta, supporting, conflicts };
  },
};
