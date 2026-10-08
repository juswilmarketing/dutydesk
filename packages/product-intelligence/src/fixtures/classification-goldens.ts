/**
 * Golden regression dataset — product family → chapter/heading gates.
 * Each case asserts identity understanding is connected to retrieval scope.
 */

export type ClassificationGolden = {
  id: string;
  description: string;
  clarification?: { id: string; value: string };
  expectedProduct: string | RegExp;
  expectedFamily: string | RegExp;
  expectedChapters: string[];
  expectedHeadingPrefix?: string;
  prohibitedChapters: string[];
  prohibitedHeadingPrefixes?: string[];
  criticalQuestionId?: string;
  consignee?: string;
};

export const CLASSIFICATION_GOLDENS: ClassificationGolden[] = [
  {
    id: "refrigerator",
    description: "REFRIGERATOR",
    expectedProduct: /refrigerat/i,
    expectedFamily: /refrigeration/i,
    expectedChapters: ["84"],
    expectedHeadingPrefix: "8418",
    prohibitedChapters: ["20", "21", "39", "63", "85", "87", "94"],
    consignee: "Persad Cocoa Foods Ltd",
  },
  {
    id: "freezer",
    description: "CHEST FREEZER 200L",
    expectedProduct: /freezer/i,
    expectedFamily: /refrigeration/i,
    expectedChapters: ["84"],
    expectedHeadingPrefix: "8418",
    prohibitedChapters: ["20", "85", "94"],
  },
  {
    id: "electric-stove",
    description: "ELECTRIC STOVE",
    expectedProduct: /stove/i,
    expectedFamily: /cooking/i,
    expectedChapters: ["85"],
    expectedHeadingPrefix: "8516",
    prohibitedChapters: ["20", "63", "87", "94"],
  },
  {
    id: "gas-stove",
    description: "GAS COOKER",
    expectedProduct: /stove|cooker/i,
    expectedFamily: /cooking/i,
    expectedChapters: ["73"],
    expectedHeadingPrefix: "7321",
    prohibitedChapters: ["20", "85"],
  },
  {
    id: "stove-energy-question",
    description: "STOVE",
    expectedProduct: /stove/i,
    expectedFamily: /cooking/i,
    expectedChapters: ["85", "73"],
    prohibitedChapters: ["20", "63", "87"],
    criticalQuestionId: "energy_source",
  },
  {
    id: "interactive-display",
    description: "I3 Technologies ELM-2 75 Interactive Display",
    expectedProduct: /display/i,
    expectedFamily: /display/i,
    expectedChapters: ["85"],
    expectedHeadingPrefix: "8528",
    prohibitedChapters: ["20", "73", "84", "87", "94"],
    prohibitedHeadingPrefixes: ["8501"],
  },
  {
    id: "smart-tv",
    description: "SMART TV 55 INCH",
    expectedProduct: /television/i,
    expectedFamily: /television|display/i,
    expectedChapters: ["85"],
    expectedHeadingPrefix: "8528",
    prohibitedChapters: ["84"],
    prohibitedHeadingPrefixes: ["8501"],
  },
  {
    id: "wall-switch",
    description: "Smart wall switch white",
    expectedProduct: /switch/i,
    expectedFamily: /switch|electrical/i,
    expectedChapters: ["85"],
    expectedHeadingPrefix: "8536",
    prohibitedChapters: ["20", "84"],
    prohibitedHeadingPrefixes: ["8501", "8528"],
  },
  {
    id: "passenger-tyre",
    description: "275/50R19 112V XL passenger tyre",
    expectedProduct: /tyre|tire/i,
    expectedFamily: /tyre/i,
    expectedChapters: ["40"],
    expectedHeadingPrefix: "4011",
    prohibitedChapters: ["87", "39", "84"],
    prohibitedHeadingPrefixes: ["8708", "4016"],
  },
  {
    id: "automotive-wheel",
    description: "VOSSO 20X9 5X120 alloy wheel",
    expectedProduct: /wheel/i,
    expectedFamily: /wheel/i,
    expectedChapters: ["87"],
    expectedHeadingPrefix: "8708",
    prohibitedChapters: ["40", "20"],
    prohibitedHeadingPrefixes: ["4011"],
  },
  {
    id: "empty-glass-bottle",
    description: "5 oz. Sauce (Woozy) Bottle, Flint, 24-414",
    expectedProduct: /bottle/i,
    expectedFamily: /glass packaging|packaging|containers/i,
    expectedChapters: ["70"],
    expectedHeadingPrefix: "7010",
    prohibitedChapters: ["20", "21", "04"],
    consignee: "Persad Cocoa Foods Ltd",
  },
  {
    id: "bath-towel",
    description: "B Towels assorted",
    expectedProduct: /towel/i,
    expectedFamily: /textile|towel/i,
    expectedChapters: ["63", "48"],
    prohibitedChapters: ["84", "85", "87"],
    criticalQuestionId: "material",
  },
  {
    id: "shower-cap",
    description: "Shower caps plastic",
    expectedProduct: /shower\s*cap/i,
    expectedFamily: /headgear|shower|plastic/i,
    expectedChapters: ["39", "65", "63"],
    prohibitedChapters: ["20", "84", "85"],
  },
  {
    id: "metal-polish",
    description: "Metal restorer and polish",
    expectedProduct: /polish|restorer/i,
    expectedFamily: /polish|clean|chemical/i,
    expectedChapters: ["34"],
    prohibitedChapters: ["20", "21", "07"],
  },
  {
    id: "microwave",
    description: "MICROWAVE OVEN",
    expectedProduct: /microwave/i,
    expectedFamily: /microwave/i,
    expectedChapters: ["85"],
    expectedHeadingPrefix: "8516",
    prohibitedChapters: ["20", "73", "84"],
  },
  {
    id: "washing-machine",
    description: "WASHING MACHINE 8KG",
    expectedProduct: /washing/i,
    expectedFamily: /laundry/i,
    expectedChapters: ["84"],
    expectedHeadingPrefix: "8450",
    prohibitedChapters: ["20", "63", "85"],
  },
  {
    id: "air-conditioner",
    description: "AIR CONDITIONER split unit",
    expectedProduct: /air conditioner/i,
    expectedFamily: /air conditioning/i,
    expectedChapters: ["84"],
    expectedHeadingPrefix: "8415",
    prohibitedChapters: ["20", "94"],
  },
  {
    id: "ladies-sandals",
    description: "Ladies sandals synthetic",
    expectedProduct: /sandal|footwear/i,
    expectedFamily: /footwear/i,
    expectedChapters: ["64"],
    prohibitedChapters: ["20", "84", "85"],
  },
  {
    id: "camping-cot",
    description: "Camping cot folding",
    expectedProduct: /cot|furniture/i,
    expectedFamily: /furniture/i,
    expectedChapters: ["94"],
    prohibitedChapters: ["20", "84", "85"],
  },
  {
    id: "diced-tomatoes",
    description: "Diced tomatoes canned",
    expectedProduct: /tomato|food|vegetable/i,
    expectedFamily: /food|tomato|vegetable/i,
    expectedChapters: ["20", "07", "21"],
    prohibitedChapters: ["70", "39", "84"],
  },
  {
    id: "led-driver",
    description: "LED driver 24V",
    expectedProduct: /driver|led/i,
    expectedFamily: /electrical|control|protection/i,
    expectedChapters: ["85"],
    prohibitedChapters: ["20", "63"],
    prohibitedHeadingPrefixes: ["8501", "8528"],
  },
];
