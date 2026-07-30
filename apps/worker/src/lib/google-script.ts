/** POST to a Google Apps Script web app (handles redirect + form body). */
export async function postGoogleAppsScript(
  scriptUrl: string,
  payload: Record<string, unknown>,
): Promise<Response> {
  let url = scriptUrl.trim();
  if (url.endsWith("/dev")) url = `${url.slice(0, -4)}/exec`;

  const body = new URLSearchParams();
  body.set("payload", JSON.stringify(payload));

  const post = (target: string) =>
    fetch(target, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
      body: body.toString(),
      redirect: "manual",
    });

  let res = await post(url);

  if ([301, 302, 303, 307, 308].includes(res.status)) {
    const location = res.headers.get("Location");
    if (location) {
      const next = location.startsWith("http") ? location : new URL(location, url).toString();
      res = await post(next);
    }
  }

  return res;
}

export function normalizeScriptUrl(scriptUrl: string): string {
  const url = scriptUrl.trim();
  if (!url.includes("script.google.com")) {
    throw new Error("GOOGLE_SCRIPT_URL must be a script.google.com/macros/s/.../exec URL");
  }
  if (!url.endsWith("/exec")) {
    throw new Error("GOOGLE_SCRIPT_URL must end with /exec (not /dev)");
  }
  return url;
}

export async function parseGoogleScriptJson(res: Response): Promise<{
  ok?: boolean;
  error?: string;
  message?: string;
  ping?: boolean;
}> {
  const text = await res.text();
  try {
    return JSON.parse(text) as { ok?: boolean; error?: string; message?: string; ping?: boolean };
  } catch {
    const snippet = text.replace(/\s+/g, " ").slice(0, 160);
    throw new Error(
      `Gmail script did not return JSON. Redeploy the Apps Script (Execute as: Me, Access: Anyone). Response: ${snippet}`,
    );
  }
}
