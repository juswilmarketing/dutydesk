import { tokenize } from "./normalize";

export interface ExtractedAttributes {
  material: string | null;
  composition: string | null;
  gender: string | null;
  ageGroup: string | null;
  brandHint: string | null;
  model: string | null;
  partNumber: string | null;
  flags: {
    food: boolean;
    chemical: boolean;
    medical: boolean;
    electrical: boolean;
    vehicle: boolean;
    construction: boolean;
    textile: boolean;
    footwear: boolean;
    machine: boolean;
    tool: boolean;
    hazardous: boolean;
    fragile: boolean;
    temperatureControlled: boolean;
    printing: boolean;
  };
  primaryFunction: string | null;
  primaryUse: string | null;
  commercialUse: boolean;
  consumerUse: boolean;
  productType: string | null;
  attributes: Record<string, string | number | boolean | null>;
}

const MATERIALS: Array<[RegExp, string]> = [
  [/\bstainless(\s+steel)?\b/, "stainless steel"],
  [/\bsteel\b/, "steel"],
  [/\baluminium\b|\baluminum\b/, "aluminium"],
  [/\bcopper\b/, "copper"],
  [/\bbrass\b/, "brass"],
  [/\bpvc\b/, "pvc"],
  [/\bplastic\b|\bpet\b|\bhdpe\b/, "plastic"],
  [/\brubber\b/, "rubber"],
  [/\bleather\b/, "leather"],
  [/\btextile\b|\bfabric\b|\bcotton\b/, "textile"],
  [/\bwood(en)?\b/, "wood"],
  [/\bglass\b/, "glass"],
  [/\bceramic\b/, "ceramic"],
];

/** True whole-word match — each alternative needs its own \\b bounds. */
function hasWord(text: string, pattern: string): boolean {
  return new RegExp(`(?:^|[^a-z0-9])(?:${pattern})(?:[^a-z0-9]|$)`, "i").test(text);
}

export function extractAttributes(desc: string): ExtractedAttributes {
  const lower = desc.toLowerCase();
  const tokens = tokenize(desc);

  let material: string | null = null;
  for (const [re, mat] of MATERIALS) {
    if (re.test(lower)) {
      material = mat;
      break;
    }
  }

  const gender = /\bwomen'?s?\b|\blad(y|ies)\b|\bfemale\b/.test(lower)
    ? "Women"
    : /\bmen'?s?\b|\bmale\b/.test(lower)
      ? "Men"
      : /\bunisex\b/.test(lower)
        ? "Unisex"
        : null;

  const ageGroup = /\bkids?|children|infant|baby\b/.test(lower)
    ? "Child"
    : /\badult\b/.test(lower)
      ? "Adult"
      : gender
        ? "Adult"
        : null;

  const partMatch = desc.match(/\b(?:p\/n|pn|part\s*#?|sku)\s*[:.]?\s*([A-Z0-9][\w./-]{2,})/i);
  const modelMatch = desc.match(/\b(?:model|mdl)\s*[:.]?\s*([A-Z0-9][\w./-]{2,})/i);

  // Printer / imaging consumables — must beat false vehicle hits from "cartridge"
  const printing =
    /\b(ymcko|ymck|printer|printing|toner|inkjet|laserjet|ribbon\s*cartridge|ink\s*cartridge|ink\s*ribbon|print\s*ribbon|dtc\d+|fargo|zebra\s*printer|id\s*card\s*printer|thermal\s*transfer|cleaning\s*roller|printhead|ribbon\s+ez)\b/i.test(
      lower,
    ) ||
    (/\bribbon\b/i.test(lower) && /\b(cartridge|images|panel|overlay|colour|color|ink)\b/i.test(lower)) ||
    (/\bcartridge\b/i.test(lower) && /\b(ink|toner|ribbon|printer|images|fargo|ymck)\b/i.test(lower));

  // Storage / racking — head noun is the rack, not a tyre/vehicle part
  const storageRack =
    /\b(tire|tyre)\s+racks?\b/i.test(lower) ||
    /\b(storage|metal|warehouse|display)\s+racks?\b/i.test(lower) ||
    /\b(shelving\s+units?|racking)\b/i.test(lower) ||
    (/\bracks?\b/i.test(lower) && !/\b(track|racket|rackets)\b/i.test(lower));

  const vehicleRaw =
    hasWord(lower, "vehicle|vehicles|automobile|automotive") ||
    hasWord(lower, "truck|trucks|lorry|lorries|bus|buses") ||
    (!storageRack && hasWord(lower, "tyre|tyres|tire|tires")) ||
    hasWord(lower, "engine|engines") ||
    // "car" / "auto" only as whole words — never match inside "cartridge" / "automation"
    hasWord(lower, "cars?") ||
    hasWord(lower, "auto");

  // Metal polish / restorers / scouring — chemical cleaning, NOT food "paste"
  const polishingPrep =
    /\bmetal\s+(restorer|polish(?:es|ing)?|cleaner|compound)\b/i.test(lower) ||
    (/\b(polish(?:es|ing)?|restorer)\b/i.test(lower) && /\bmetal\b/i.test(lower)) ||
    /\b(furniture|shoe|floor|coachwork)\s+polish/i.test(lower) ||
    /\b(scouring\s+(paste|powder|preparation)|cleaning\s+preparation)\b/i.test(lower);

  // Food: require edible nouns — bare "paste"/"cream"/"preparation" alone must NOT trigger food
  const food =
    !polishingPrep &&
    (hasWord(lower, "food|milk|tomato|sugar|rice|flour|meat|fish|fruit|vegetable|spice|spices") ||
      /\b(tomato\s+paste|fish\s+paste|meat\s+paste|food\s+paste|food\s+preparation)\b/i.test(lower));

  const flags = {
    food,
    chemical:
      polishingPrep ||
      hasWord(lower, "chemical|solvent|acid|fertilizer|fertiliser|paint|adhesive|polish|restorer|detergent|degreaser"),
    medical: hasWord(lower, "medical|surgical|sterile|syringe|hospital|pharma|pharmaceutical"),
    electrical: hasWord(
      lower,
      "electrical|led|driver|transformer|cable|wire|battery|voltage|motor|motors",
    ),
    // Never treat printer cartridges / ribbons as vehicle parts
    // Never treat tire/tyre racks (storage) as vehicle articles
    vehicle: vehicleRaw && !printing && !storageRack,
    construction: hasWord(lower, "cement|concrete|pipe|fitting|pvc|rebar|lumber"),
    textile: hasWord(lower, "textile|fabric|garment|apparel|shirt|pants|cotton"),
    footwear: hasWord(lower, "shoe|shoes|sandal|sandals|boot|boots|sneaker|sneakers|footwear"),
    machine: hasWord(lower, "machine|pump|compressor|generator|press"),
    tool: hasWord(lower, "tool|wrench|drill|hammer|screwdriver"),
    hazardous: hasWord(lower, "hazard|flammable|toxic|corrosive|dangerous"),
    fragile: hasWord(lower, "fragile|glass|ceramic"),
    temperatureControlled: hasWord(lower, "frozen|chilled|refrigerat|cold chain"),
    printing,
  };

  let primaryFunction: string | null = null;
  let primaryUse: string | null = null;
  let productType: string | null = null;
  let commercialUse = true;
  let consumerUse = false;

  if (flags.printing) {
    primaryFunction = "Printing / image transfer";
    primaryUse = "Office/ID printing";
    productType = /\btoner\b/.test(lower)
      ? "Toner cartridge"
      : /\b(ink\s*cartridge|inkjet)\b/.test(lower)
        ? "Ink cartridge"
        : /\bribbon\b/.test(lower)
          ? "Printer ribbon"
          : "Printing consumable";
    commercialUse = true;
  } else if (polishingPrep) {
    primaryFunction = "Clean, restore and polish metal surfaces";
    primaryUse = "Cleaning and maintenance";
    productType = /\bmetal\b/.test(lower)
      ? "metal polishing preparation"
      : "polishing preparation";
    commercialUse = true;
    consumerUse = true;
  } else if (flags.footwear) {
    primaryFunction = "Wear on feet";
    primaryUse = "Personal";
    productType = /\bsandal/.test(lower) ? "Sandal" : /\bboot/.test(lower) ? "Boot" : "Shoe";
    consumerUse = true;
  } else if (flags.food) {
    primaryFunction = "Human consumption";
    primaryUse = "Food";
    productType = "Food product";
    consumerUse = true;
  } else if (flags.electrical) {
    primaryFunction = "Electrical operation";
    primaryUse = "Industrial/Commercial";
    productType = /\btransformer/.test(lower)
      ? "Transformer"
      : /\bled|driver|power supply/.test(lower)
        ? "Power supply"
        : "Electrical article";
  } else if (flags.construction) {
    primaryFunction = "Construction/installation";
    primaryUse = "Construction";
    productType = /\bpipe|fitting|elbow/.test(lower) ? "Pipe/Fitting" : "Construction material";
  } else if (storageRack) {
    primaryFunction = "Store or display goods";
    primaryUse = "Storage/display";
    productType = /\bshelf|shelving\b/i.test(lower) ? "Shelving" : "Storage Rack";
    commercialUse = true;
  } else if (flags.vehicle) {
    primaryFunction = "Vehicle use";
    primaryUse = "Automotive";
    productType = "Vehicle article";
  } else if (/\btable|chair|furniture\b/.test(lower)) {
    primaryFunction = "Furnish space";
    primaryUse = "Household/Office";
    productType = "Furniture";
    consumerUse = true;
  }

  const attributes: Record<string, string | number | boolean | null> = {
    material,
    gender,
    ageGroup,
    tokenCount: tokens.length,
  };
  if (flags.printing) {
    attributes.print_consumable = productType;
    attributes.device_type = "ID/card or document printer";
  }

  return {
    material,
    composition: null,
    gender,
    ageGroup,
    brandHint: null,
    model: modelMatch?.[1] ?? null,
    partNumber: partMatch?.[1] ?? null,
    flags,
    primaryFunction,
    primaryUse,
    commercialUse,
    consumerUse,
    productType,
    attributes,
  };
}
