# Security Notice

## Exposed API Key — Action Required

The legacy monolith (`pas-cloudflare-polished.zip`) contained a **hardcoded Anthropic API key** in client-side JavaScript. Anyone with that zip can extract and abuse it.

**Before deploying this application:**

1. Log in to [Anthropic Console](https://console.anthropic.com/) → API Keys
2. **Revoke** the key that was embedded in the old `index.html`
3. Create a new key and set it only as a Cloudflare Worker secret:
   ```bash
   wrangler secret put ANTHROPIC_API_KEY
   ```

This codebase **never** embeds API keys, passwords, or third-party master keys in the frontend bundle.

## Legacy Issues Remediated

| Issue | Remediation |
|-------|-------------|
| Hardcoded Anthropic key | Worker proxy + Wrangler secret |
| Client-side user/password array | D1 users + bcrypt + httpOnly session cookie |
| XSS in HTML exports | HTML-escaped templates |
| JSONBin keys in localStorage | D1 learned classifications via Worker API |
| Babel in browser | Vite build-time bundling |
