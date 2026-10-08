/**
 * Extract a JSON object/array from model text that may include prose or fences.
 * Returns null when no valid JSON payload can be recovered.
 */
export function extractJsonFromModelText(text: string): unknown | null {
  const cleaned = String(text || "")
    .replace(/```json\s*/gi, "")
    .replace(/```/g, "")
    .trim();
  if (!cleaned) return null;

  try {
    return JSON.parse(cleaned);
  } catch {
    /* continue */
  }

  const objectMatch = cleaned.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    try {
      return JSON.parse(objectMatch[0]);
    } catch {
      /* continue */
    }
  }

  const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    try {
      return JSON.parse(arrayMatch[0]);
    } catch {
      /* continue */
    }
  }

  return null;
}
