/** Pinned Sonnet model for classify + invoice parse (see Anthropic model deprecations). */
export const CLAUDE_MODEL = "claude-sonnet-4-6";

type AnthropicResponse = {
  error?: { type?: string; message?: string };
  content?: Array<{ text?: string }>;
};

export function anthropicErrorMessage(data: AnthropicResponse, status: number): string {
  const raw = data.error?.message?.trim();
  if (!raw) return `Anthropic API error (${status})`;
  if (raw.startsWith("model:")) {
    return "AI model is no longer available. Contact your administrator to update the worker.";
  }
  return raw;
}

export async function anthropicMessages(
  apiKey: string,
  messages: unknown[],
  maxTokens: number,
): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: maxTokens,
      messages,
    }),
  });
  const data = (await res.json()) as AnthropicResponse;
  if (!res.ok) throw new Error(anthropicErrorMessage(data, res.status));
  return (data.content || []).map((b) => b.text || "").join("");
}

export async function anthropicDocument(
  apiKey: string,
  base64: string,
  mediaType: string,
  prompt: string,
  maxTokens: number,
): Promise<string> {
  const isImage = mediaType.startsWith("image/");
  const docBlock = isImage
    ? { type: "image" as const, source: { type: "base64" as const, media_type: mediaType, data: base64 } }
    : { type: "document" as const, source: { type: "base64" as const, media_type: mediaType, data: base64 } };

  return anthropicMessages(
    apiKey,
    [
      {
        role: "user",
        content: [docBlock, { type: "text", text: prompt }],
      },
    ],
    maxTokens,
  );
}
