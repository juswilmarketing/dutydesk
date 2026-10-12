import { describe, expect, it } from "vitest";
import { codeDigits, detectCorrection, suggestedTop, type CorrectionInput } from "./correction-capture";

const input = (over: Partial<CorrectionInput> = {}): CorrectionInput => ({
  description: "LED DRIVER 24V",
  supplier: null,
  appliedCode: "8504.40.90",
  previousStatus: "Suggestion Ready",
  previousCode: null,
  previousLabel: null,
  suggestedCode: "8504.40.90",
  suggestedLabel: "Strong Match",
  ...over,
});

describe("codeDigits", () => {
  it("strips dots and spaces", () => {
    expect(codeDigits("8504.40 90")).toBe("85044090");
    expect(codeDigits(null)).toBe("");
  });
});

describe("detectCorrection", () => {
  it("returns null when the clerk applies the top suggestion", () => {
    expect(detectCorrection(input())).toBeNull();
  });

  it("returns null when there is no suggestion and no previous code", () => {
    expect(detectCorrection(input({ suggestedCode: null, suggestedLabel: null }))).toBeNull();
  });

  it("captures a rejected suggestion", () => {
    const r = detectCorrection(input({ suggestedCode: "8536.30.00", suggestedLabel: "Strong Match" }));
    expect(r).toEqual({
      kind: "rejected_suggestion",
      rawDescription: "LED DRIVER 24V",
      supplier: null,
      expectedTariff: "8504.40.90",
      expectedHeading: "8504",
      expectedChapter: "85",
      replacedCode: "8536.30.00",
      replacedLabel: "Strong Match",
      notes: "Clerk rejected suggestion 8536.30.00 (Strong Match); applied 8504.40.90",
    });
  });

  it("captures a change to an already-applied code, preferring it over the suggestion", () => {
    const r = detectCorrection(input({
      previousStatus: "Applied",
      previousCode: "8536.30.00",
      previousLabel: "Strong Match",
      suggestedCode: "8536.30.00",
    }));
    expect(r?.kind).toBe("changed_applied");
    expect(r?.replacedCode).toBe("8536.30.00");
    expect(r?.replacedLabel).toBe("Strong Match");
    expect(r?.notes).toBe("Clerk changed applied code 8536.30.00 (Strong Match) to 8504.40.90");
  });

  it("omits the label from notes when unknown", () => {
    const r = detectCorrection(input({ previousStatus: "Applied", previousCode: "8536.30.00" }));
    expect(r?.notes).toBe("Clerk changed applied code 8536.30.00 to 8504.40.90");
  });

  it("is not a correction to re-apply the same code to an applied line", () => {
    expect(detectCorrection(input({
      previousStatus: "Applied",
      previousCode: "8504.40.90",
      suggestedCode: "8536.30.00",
    }))).toBeNull();
  });

  it("ignores codes that differ only in punctuation", () => {
    expect(detectCorrection(input({ suggestedCode: "85044090" }))).toBeNull();
  });

  it("returns null for a blank description or a code shorter than a heading", () => {
    expect(detectCorrection(input({ description: "  ", suggestedCode: "8536.30.00" }))).toBeNull();
    expect(detectCorrection(input({ appliedCode: "85", suggestedCode: "8536.30.00" }))).toBeNull();
  });

  it("trims description and supplier", () => {
    const r = detectCorrection(input({ description: " LED DRIVER ", supplier: " Acme ", suggestedCode: "8536.30.00" }));
    expect(r?.rawDescription).toBe("LED DRIVER");
    expect(r?.supplier).toBe("Acme");
  });
});

describe("suggestedTop", () => {
  it("reads code and label from the stored recommended candidate", () => {
    expect(suggestedTop(JSON.stringify({ code: "8536.30.00", confidenceLabel: "Strong Match" })))
      .toEqual({ code: "8536.30.00", label: "Strong Match" });
  });

  it("returns null for missing, null or malformed JSON", () => {
    expect(suggestedTop(null)).toBeNull();
    expect(suggestedTop("null")).toBeNull();
    expect(suggestedTop("{not json")).toBeNull();
    expect(suggestedTop(JSON.stringify({ confidenceLabel: "Strong Match" }))).toBeNull();
  });

  it("returns a null label when absent", () => {
    expect(suggestedTop(JSON.stringify({ code: "8536.30.00" }))).toEqual({ code: "8536.30.00", label: null });
  });
});
