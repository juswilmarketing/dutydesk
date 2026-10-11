# What is Duty Desk?

Duty Desk is PAS Trinidad's internal web app for preparing **customs worksheets**. A clerk uploads a supplier
invoice, the app reads the line items, helps classify each item under the correct **Trinidad & Tobago tariff
code**, calculates the **import duty and VAT**, and produces the worksheet that goes to the customer or on to
customs clearance.

It replaces an older single-file tool (one large HTML page with the tariff table embedded) with a secure,
multi-user web app hosted on Cloudflare.

## Who uses it

| Role | What they do |
|------|--------------|
| **Clerk** | Day-to-day jobs: upload invoices, classify items, calculate taxes, send worksheets. |
| **Admin** | Everything a clerk does, plus managing users and the classification knowledge (dictionaries, rules, supplier catalogues). |

Everyone signs in with their own account. Sessions expire after 24 hours.

## The workflow (one job at a time)

1. **Upload** — drop a supplier invoice (PDF, JPG or PNG). AI reads it and extracts the line items:
   description, quantity, unit price. Items can also be typed in on the **Manual** page.
2. **Classification** — each line gets a suggested tariff code from the T&T tariff (6,101 entries). Suggestions
   come from what the team has used before for that supplier/product, built-in product knowledge, and AI.
   The clerk reviews and confirms or corrects them.
3. **Duties & Taxes** — enter freight, insurance, other charges and the exchange rate. The app calculates CIF,
   import duty, VAT, the user fee and container fees, and the total payable. Exemptions can be applied per item.
4. **Worksheet** — review the grouped worksheet, add the worksheet number and consignee, then **Complete Job**:
   - **Classification Only** — email or WhatsApp the tax advice PDF straight to the customer.
   - **Brokerage Clearance** — send the full package (worksheet, tax breakdown, invoice, attachments) to
     **FlowBoard**, which handles customer approval, payment and clearance tracking.
5. **Next job** — once sent, the screen clears automatically and returns to Upload with a confirmation banner.
   **Start new job** discards the current job at any time.

Unfinished work is saved to the server as you go, so it survives a refresh, a sign-out, or switching computers.
If saving fails, a "Not saved — retrying" warning appears until the connection recovers.

## Other pages

| Page | Purpose |
|------|---------|
| **Dashboard** | Counts of jobs pending classification, ready for worksheet, sent to FlowBoard, failed exports; the active job's progress. |
| **Brokerage / FlowBoard** | Hand-off and status of brokerage clearance jobs. |
| **ASYCUDA** | Prepare data for the customs ASYCUDA system. |
| **Reports** | Classification and tax reports. |
| **Learned codes** | Tariff codes the team has confirmed before, reused for future suggestions. |
| **Admin pages** | Users, product/brand/industry dictionaries, abbreviations, supplier catalogues and history, chapter and question rules, liquid composition rules, learning statistics, integrations. |

## How classification gets smarter

Every confirmed classification is remembered against the supplier and product. Next time the same or a similar
item appears, the app suggests that code first. Admins can add rules and dictionary entries (brands,
abbreviations, product families) to steer suggestions. A suite of "golden" test cases checks accuracy on
known products.

## Connected systems

| System | Used for |
|--------|----------|
| **FlowBoard** (PAS's job board) | Receives brokerage clearance jobs; sends customer email/WhatsApp and tracks clearance. |
| **Anthropic Claude (AI)** | Reading invoices and suggesting classifications. |
| **Google Apps Script (Gmail)** | Sending tax advice emails directly from the app. |
| **Cloudflare** | Hosting (Workers), database (D1), sessions (KV), uploaded documents (R2). |

## Where it runs

| Address | Notes |
|---------|-------|
| https://dutydesk.mwilson-561.workers.dev | Main deployment (Worker `dutydesk`). |
| https://pas-trinidad-api.mwilson-561.workers.dev | Second deployment of the same app (Worker `pas-trinidad-api`); shares the same database. |

Both deployments use the same data, so a job started on one is visible on the other.

## How it is built (for developers)

| Part | What it is |
|------|------------|
| `apps/web` | React + TypeScript single-page app (Vite). Tariff search runs in the browser. |
| `apps/worker` | API on Cloudflare Workers (Hono): sign-in, AI calls, jobs, email, FlowBoard, documents. |
| `packages/tariff-data` | The T&T tariff table and search. |
| `packages/tax-engine` | CIF / duty / VAT calculations. |
| `packages/product-intelligence` | Product recognition and classification routing. |
| `packages/shared-types` | Types shared between the app and the API. |
| `migrations/` | Database schema changes (D1 / SQLite), applied in order. |

Setup, local development and deployment steps are in [README.md](../README.md). Security notes are in
[SECURITY.md](../SECURITY.md). Planned improvements are in
[docs/superpowers/specs/2026-10-08-simplified-workflow-design.md](./superpowers/specs/2026-10-08-simplified-workflow-design.md).

## Roadmap

- **Done (Phase 1):** jobs saved on the server; screen clears automatically after a worksheet is sent.
- **Phase 2:** stricter "strong match" rule and better confidence scores for classification.
- **Phase 3:** faster classification screen — bulk-apply strong matches, review only the exceptions, simpler
  navigation (Upload → Classify → Duties & Taxes → Worksheet & Send).
- **Phase 4:** learn from corrections; expand accuracy tests with a ≥98% precision target on strong matches.
