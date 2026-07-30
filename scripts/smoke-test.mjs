const base = process.env.WORKER_URL || "http://127.0.0.1:8787";

async function req(path, init = {}) {
  const res = await fetch(`${base}${path}`, {
    headers: { "Content-Type": "application/json", ...(init.headers || {}) },
    ...init,
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { ok: res.ok, status: res.status, data, headers: res.headers };
}

let cookie = "";
function withCookie(headers = {}) {
  return cookie ? { ...headers, Cookie: cookie } : headers;
}

const health = await req("/api/health");
if (!health.ok) throw new Error("Health check failed");

await req("/api/auth/seed", {
  method: "POST",
  body: JSON.stringify({ username: "admin", password: "changeme", name: "Admin", role: "admin" }),
});

const login = await req("/api/auth/login", {
  method: "POST",
  body: JSON.stringify({ username: "admin", password: "changeme" }),
});
const setCookie = login.headers.get("set-cookie");
if (setCookie) cookie = setCookie.split(";")[0];

const me = await req("/api/auth/me", { headers: withCookie() });
if (!me.ok) throw new Error("Auth me failed");

const search = await req("/api/tariff/search?q=monkey", { headers: withCookie() });
if (!search.ok || !search.data.results?.length) throw new Error("Tariff search failed");

console.log("Smoke test passed:");
console.log(`  health: ${health.data.service}`);
console.log(`  user: ${me.data.name} (${me.data.role})`);
console.log(`  tariff hits: ${search.data.results.length}`);
