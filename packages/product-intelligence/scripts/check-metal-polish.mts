import { runProductIntelligence, loadSeedDictionaries, detectProductDomain } from "../src/index.ts";

const desc = "3M Metal Restorer and Polish, 09019, 18";
const domain = detectProductDomain(desc);
const result = runProductIntelligence({
  line_id: 1,
  description: desc,
  dictionaries: loadSeedDictionaries(),
});

console.log(JSON.stringify({
  domain: domain.domain,
  likelyChapters: domain.likelyChapters,
  productType: result.profile.productType,
  industry: result.profile.industry,
  chemical: result.profile.chemical,
  food: result.profile.food,
  chapter: result.predictions.chapter,
  headings: result.predictions.headings.slice(0, 3).map((h) => ({ code: h.hs_code, heading: h.heading, score: h.score })),
  predicted: result.predictions.predictedHsCode,
  path: result.path,
}, null, 2));

if (result.predictions.chapter !== "34") {
  console.error("FAIL: expected chapter 34");
  process.exit(1);
}
if (result.predictions.headings.some((h) => h.hs_code.startsWith("20"))) {
  console.error("FAIL: chapter 20 must not appear in candidates");
  process.exit(1);
}
if (!result.predictions.headings.some((h) => h.heading.startsWith("34.05") || h.hs_code.startsWith("3405"))) {
  console.error("FAIL: expected 3405 among candidates");
  process.exit(1);
}
console.log("OK");
