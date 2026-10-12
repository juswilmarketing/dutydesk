import { describe, expect, it } from "vitest";
import { aiResponseStatus } from "./ai-response-status";

const ok = { question: null, provisional: false, selectedConfidence: 0.8, parsed: true };

describe("aiResponseStatus", () => {
  it("recommends a parsed, confident, non-provisional reply", () => {
    expect(aiResponseStatus(ok)).toBe("recommended");
  });

  it("is provisional when the AI reply was not parseable JSON", () => {
    expect(aiResponseStatus({ ...ok, parsed: false })).toBe("provisional");
  });

  it("is provisional when the engine is provisional", () => {
    expect(aiResponseStatus({ ...ok, provisional: true })).toBe("provisional");
  });

  it("is provisional when the selected confidence is below 0.55", () => {
    expect(aiResponseStatus({ ...ok, selectedConfidence: 0.54 })).toBe("provisional");
    expect(aiResponseStatus({ ...ok, selectedConfidence: 0.55 })).toBe("recommended");
  });

  it("asks for clarification when a question exists and the engine is provisional", () => {
    const question = { id: "q1" };
    expect(aiResponseStatus({ ...ok, question, provisional: true })).toBe("clarification_needed");
    expect(aiResponseStatus({ ...ok, question, provisional: true, parsed: false })).toBe("clarification_needed");
  });

  it("does not ask for clarification just because a question exists", () => {
    expect(aiResponseStatus({ ...ok, question: { id: "q1" } })).toBe("recommended");
    expect(aiResponseStatus({ ...ok, question: { id: "q1" }, parsed: false })).toBe("provisional");
  });
});
