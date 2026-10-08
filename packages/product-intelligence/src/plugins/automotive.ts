/**
 * Automotive product-family plugin: tyres, wheels, hub rings, lug nuts.
 */

import type { PluginMatch, ProductFamilyPlugin } from "./types";

const FOOD = [
  "01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12", "13", "14",
  "15", "16", "17", "18", "19", "20", "21", "22", "23", "24",
];

const TYRE_SIZE = /\b(\d{3})\s*\/\s*(\d{2})\s*R\s*(\d{2})\b/i;
const LOAD_SPEED = /\b(\d{2,3})([HWVRSTYZ])\b/i;
const WHEEL =
  /\b([A-Z][A-Z0-9-]{2,})\s+(\d{2})\s*[xX×]\s*(\d{1,2}(?:\.\d)?)\s+(\d)\s*[xX×]\s*(\d{2,3})\b/i;
const WHEEL_LOOSE =
  /\b(\d{2})\s*[xX×]\s*(\d{1,2}(?:\.\d)?)\b.*\b(\d)\s*[xX×]\s*(\d{2,3})\b/i;
const LUG_NUT =
  /\b(\d)\s*lug\b|\blug\s*nut|\bspline\b.*\b(wik|kit|pass)\b|\b(\d{2})\s*[-–]\s*(\d\.\d{2})\b.*\b(spln|spline|lug)\b/i;

const TYRE_BRANDS = /\b(BS|bridgestone|michelin|goodyear|continental|pirelli|dunlop|yokohama|toyo|hankook|kumho|falken|nexen|al[ae]nza|turanza|potenza|primacy)\b/i;

function supplierAutomotive(supplier?: string | null): boolean {
  if (!supplier) return false;
  return /\b(tire\s*rack|tyre\s*rack|wheel\s*pros|discount\s*tire|americas\s*tire|samsara|pas\s*cargo)\b/i.test(
    supplier,
  );
}

function matchTyre(raw: string, supplier?: string | null): PluginMatch | null {
  const size = raw.match(TYRE_SIZE);
  if (!size && !(supplierAutomotive(supplier) && /\b(XL|R\d{2})\b/i.test(raw) && TYRE_BRANDS.test(raw))) {
    return null;
  }
  if (!size) return null;

  const tyreSize = `${size[1]}/${size[2]}R${size[3]}`;
  const load = raw.match(LOAD_SPEED);
  const loadSpeed = load ? `${load[1]}${load[2].toUpperCase()}` : "";
  const xl = /\bXL\b/i.test(raw);
  const diameter = Number(size[3]);
  const passengerLikely = diameter >= 13 && diameter <= 22;

  return {
    pluginId: "automotive",
    confidence: 0.93,
    canonicalProduct: "new pneumatic passenger-vehicle tyre",
    productNoun: "tyre",
    productFamily: "pneumatic tyres",
    industry: "automotive",
    material: "rubber",
    primaryFunction: "support and propel a motor vehicle",
    intendedUse: passengerLikely ? "passenger motor car" : "motor vehicle",
    physicalForm: "pneumatic tyre",
    finishedState: "finished article",
    partOrCompleteArticle: "complete article",
    brand: TYRE_BRANDS.test(raw) ? (raw.match(TYRE_BRANDS)?.[1] || "") : "",
    model: "",
    skuHints: [],
    dimensions: {
      tyreSize,
      sectionWidth: size[1],
      aspectRatio: size[2],
      rimDiameter: size[3],
      loadSpeedRating: loadSpeed || null,
      reinforced: xl,
    },
    technicalSpecifications: {
      tyreSize,
      loadSpeedRating: loadSpeed || null,
      reinforced: xl,
    },
    likelyChapters: ["40"],
    excludedChapters: [...FOOD, "63", "84", "85", "94"],
    preferredHeadings: ["4011"],
    prohibitedHeadings: ["4016", "8708", "870870"],
    missingCriticalAttributes: [],
    searchTerms: [
      "pneumatic tyres",
      "new pneumatic",
      "motor cars",
      "buses or lorries",
      tyreSize,
      "rubber",
    ],
    administrativeCodes: [],
    notes: [
      "Tyre size pattern detected — classify under heading 4011, not wheels or other rubber articles.",
    ],
  };
}

function matchWheel(raw: string): PluginMatch | null {
  let brand = "";
  let diameter = "";
  let width = "";
  let bolt = "";
  let bore = "";
  let offset = "";

  const m = raw.match(WHEEL);
  if (m) {
    brand = m[1];
    diameter = m[2];
    width = m[3];
    bolt = `${m[4]}x${m[5]}`;
  } else {
    const loose = raw.match(WHEEL_LOOSE);
    if (!loose) return null;
    diameter = loose[1];
    width = loose[2];
    bolt = `${loose[3]}x${loose[4]}`;
    const brandHit = raw.match(/^([A-Z][A-Z0-9-]{2,})\b/);
    brand = brandHit?.[1] || "";
  }

  // Avoid matching tyre sizes
  if (TYRE_SIZE.test(raw)) return null;
  // Require wheel-ish context (inches + bolt pattern), not random XxY
  if (!/\b\d\s*[xX×]\s*\d{2,3}\b/.test(raw)) return null;

  const boreHit = raw.match(/\b(\d{2,3})\b(?!\s*[xX×])/g);
  const offsetHit = raw.match(/\b(\d{1,3})\s*MM\b/i);
  if (boreHit && boreHit.length) {
    // Prefer a standalone number near BD / centre bore
    const bd = raw.match(/\b(\d{2,3})\s*BD\b/i) || raw.match(/\bBD\s*(\d{2,3})\b/i);
    bore = bd?.[1] || "";
  }
  offset = offsetHit?.[1] || "";

  return {
    pluginId: "automotive",
    confidence: 0.9,
    canonicalProduct: "automotive road wheel/rim",
    productNoun: "wheel",
    productFamily: "motor vehicle road wheels",
    industry: "automotive",
    material: "",
    primaryFunction: "mount and support a vehicle tyre",
    intendedUse: "motor vehicle",
    physicalForm: "road wheel / rim",
    finishedState: "finished article",
    partOrCompleteArticle: "complete article",
    brand,
    model: brand,
    skuHints: [],
    dimensions: {
      diameterInches: diameter,
      widthInches: width,
      boltPattern: bolt,
      centreBoreMm: bore || null,
      offsetMm: offset || null,
    },
    technicalSpecifications: {
      diameter: `${diameter} inches`,
      width: `${width} inches`,
      boltPattern: bolt,
      centreBore: bore ? `${bore} mm` : null,
      offset: offset ? `${offset} mm` : null,
    },
    likelyChapters: ["87"],
    excludedChapters: [...FOOD, "40", "63", "84", "85"],
    preferredHeadings: ["870870", "8708"],
    prohibitedHeadings: ["4011", "4016", "7113"],
    missingCriticalAttributes: [],
    searchTerms: ["road wheels", "wheels", "motor vehicles", "parts and accessories"],
    administrativeCodes: [],
    notes: ["Wheel/rim geometry detected — prefer heading 8708.70."],
  };
}

function matchHubRing(raw: string): PluginMatch | null {
  if (!/\bhub\s*ring/i.test(raw) && !(/\bOD\b/i.test(raw) && /\bID\b/i.test(raw) && /\bring/i.test(raw))) {
    return null;
  }
  const od = raw.match(/(\d{2,3}(?:\.\d+)?)\s*OD/i);
  const id = raw.match(/(\d{2,3}(?:\.\d+)?)\s*ID/i);
  const pack = raw.match(/\((\d+)\s*PK\)|\b(\d+)\s*PK\b|\bset\b/i);

  return {
    pluginId: "automotive",
    confidence: 0.88,
    canonicalProduct: "automotive hub-centering ring set",
    productNoun: "hub ring",
    productFamily: "automotive wheel fitting",
    industry: "automotive",
    material: "unknown",
    primaryFunction: "centre a road wheel on a vehicle hub",
    intendedUse: "automotive wheel fitting",
    physicalForm: "ring set",
    finishedState: "finished article",
    partOrCompleteArticle: "accessory",
    brand: "",
    model: "",
    skuHints: [],
    dimensions: {
      outerDiameterMm: od?.[1] || null,
      innerDiameterMm: id?.[1] || null,
      packQuantity: pack?.[1] || pack?.[2] || null,
    },
    technicalSpecifications: {
      outerDiameter: od ? `${od[1]} mm` : null,
      innerDiameter: id ? `${id[1]} mm` : null,
      packQuantity: pack?.[1] || pack?.[2] || null,
    },
    likelyChapters: ["87", "39", "73"],
    excludedChapters: [...FOOD, "71", "84", "85", "63"],
    preferredHeadings: ["8708", "870870"],
    prohibitedHeadings: ["7113", "8482", "4016"],
    missingCriticalAttributes: ["material"],
    searchTerms: ["hub", "wheel", "motor vehicles", "parts", "centring", "centering"],
    administrativeCodes: [],
    notes: [
      "Hub-centric ring — not a bearing, jewellery ring, or sealing ring.",
      "Ask material only if needed to distinguish plausible headings.",
    ],
  };
}

function matchLugNut(raw: string): PluginMatch | null {
  if (!LUG_NUT.test(raw) && !/\blug\b/i.test(raw)) return null;
  if (!/\b(lug|spln|spline|wik)\b/i.test(raw)) return null;

  const thread = raw.match(/\b(\d{2})\s*[-–]\s*(\d\.\d{2})\b/);
  const lugCount = raw.match(/\b(\d)\s*lug\b/i);

  return {
    pluginId: "automotive",
    confidence: 0.86,
    canonicalProduct: "automotive spline lug-nut kit",
    productNoun: "lug nut",
    productFamily: "automotive wheel fastening hardware",
    industry: "automotive",
    material: "steel",
    primaryFunction: "fasten a road wheel to a vehicle hub",
    intendedUse: "motor vehicle wheel fastening",
    physicalForm: "threaded fastener kit",
    finishedState: "finished article",
    partOrCompleteArticle: "accessory",
    brand: "",
    model: "",
    skuHints: [],
    dimensions: {
      lugCount: lugCount?.[1] || "5",
      thread: thread ? `M${thread[1]} x ${thread[2]}` : "M14 x 1.50",
    },
    technicalSpecifications: {
      threadSpecification: thread ? `M${thread[1]} x ${thread[2]}` : "M14 x 1.50",
      spline: /\bspln|spline/i.test(raw),
      finish: /\bblk|black/i.test(raw) ? "black" : null,
    },
    likelyChapters: ["73", "87"],
    excludedChapters: [...FOOD, "40", "63", "71", "84", "85"],
    preferredHeadings: ["7318", "8708"],
    prohibitedHeadings: ["7113", "4016"],
    missingCriticalAttributes: [],
    searchTerms: ["nuts", "screws", "bolts", "threaded", "motor vehicles", "wheels"],
    administrativeCodes: [],
    notes: [
      "Compare threaded fasteners (7318) with any specific vehicle-parts provision; do not force an unsupported exact line.",
    ],
  };
}

export const automotivePlugin: ProductFamilyPlugin = {
  id: "automotive",
  label: "Automotive",
  match(rawDescription, context) {
    const raw = String(rawDescription || "").trim();
    if (!raw) return null;
    return (
      matchTyre(raw, context?.supplier)
      || matchWheel(raw)
      || matchHubRing(raw)
      || matchLugNut(raw)
    );
  },
  scoreCandidate(match, candidate) {
    const supporting: string[] = [];
    const conflicts: string[] = [];
    let delta = 0;
    const heading = candidate.heading.replace(/\D/g, "");
    const desc = candidate.description.toLowerCase();

    if (match.preferredHeadings.some((h) => heading.startsWith(h.replace(/\D/g, "").slice(0, 4)))) {
      delta += 35;
      supporting.push(`Preferred automotive heading family ${match.preferredHeadings.join("/")}`);
    }
    for (const bad of match.prohibitedHeadings) {
      if (heading.startsWith(bad.replace(/\D/g, "").slice(0, 4))) {
        delta -= 80;
        conflicts.push(`Prohibited heading family ${bad} for ${match.canonicalProduct}`);
      }
    }

    if (/tyre|tire|pneumatic/i.test(match.canonicalProduct)) {
      if (/pneumatic|tyre|tire|motor car|bus|lorrie|other/i.test(desc)) delta += 20;
      if (/retread|used|solid/i.test(desc)) delta -= 25;
      if (/other articles of vulcanised|gasket|seal/i.test(desc)) {
        delta -= 60;
        conflicts.push("Other rubber articles (4016) unsuitable for new pneumatic tyres");
      }
      if (/wheel|road wheel/i.test(desc) && candidate.chapter === "87") {
        delta -= 70;
        conflicts.push("Road wheels are not pneumatic tyres");
      }
      // Prefer passenger-relevant lines when present; otherwise "Other" over bus/lorry/aircraft
      if (/motor car|passenger/i.test(desc)) delta += 25;
      else if (/^other$/i.test(desc.trim()) || /\bother\b/i.test(desc)) delta += 12;
      else if (/bus|lorrie|aircraft|motorcycle|bicycle|agricultural|construction/i.test(desc)) delta -= 8;
    }

    if (/road wheel|rim/i.test(match.canonicalProduct)) {
      if (/road wheels|wheels/i.test(desc)) delta += 30;
      if (/tractors/i.test(desc)) delta -= 10;
      if (/pneumatic|tyre|tire/i.test(desc) && candidate.chapter === "40") {
        delta -= 70;
        conflicts.push("Pneumatic tyre heading unsuitable for road wheels");
      }
    }

    if (/hub-centering|hub ring/i.test(match.canonicalProduct)) {
      if (/bearing|jewellery|jewelry|seal|gasket/i.test(desc)) {
        delta -= 80;
        conflicts.push("Not a bearing, jewellery, or sealing ring");
      }
      if (/wheel|vehicle|motor/i.test(desc)) delta += 12;
    }

    if (/lug-nut|lug nut/i.test(match.canonicalProduct)) {
      if (/nut|screw|bolt|threaded/i.test(desc)) delta += 18;
      if (/jewellery|jewelry/i.test(desc)) {
        delta -= 80;
        conflicts.push("Not jewellery");
      }
    }

    return { delta, supporting, conflicts };
  },
};
