import { PDFDocument } from "pdf-lib";
import type { ParsedInvoice } from "@pas/shared-types";

export type PdfChunk = {
  base64: string;
  mediaType: string;
  fromPage: number;
  toPage: number;
  totalPages: number;
};

function uint8ToBase64(bytes: Uint8Array): string {
  const chunk = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** Pages per Anthropic call — keep small to stay under Cloudflare ~100s limits. */
export function pagesPerChunkFor(totalPages: number): number {
  if (totalPages <= 4) return totalPages;
  if (totalPages <= 12) return 3;
  if (totalPages <= 24) return 2;
  return 2;
}

export async function splitPdfFile(
  file: File,
  onProgress?: (msg: string) => void,
): Promise<PdfChunk[]> {
  const isPdf =
    file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");

  if (!isPdf) {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result || ""));
      r.onerror = () => reject(new Error("Read failed"));
      r.readAsDataURL(file);
    });
    const base64 = dataUrl.includes(",") ? dataUrl.split(",")[1] : dataUrl;
    return [
      {
        base64,
        mediaType: file.type || "image/jpeg",
        fromPage: 1,
        toPage: 1,
        totalPages: 1,
      },
    ];
  }

  onProgress?.("Reading PDF…");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const totalPages = src.getPageCount();
  const per = pagesPerChunkFor(totalPages);

  if (totalPages <= per) {
    onProgress?.(`PDF has ${totalPages} page(s) — sending as one batch`);
    return [
      {
        base64: uint8ToBase64(bytes),
        mediaType: "application/pdf",
        fromPage: 1,
        toPage: totalPages,
        totalPages,
      },
    ];
  }

  onProgress?.(`PDF has ${totalPages} pages — splitting into ${per}-page batches`);
  const chunks: PdfChunk[] = [];

  for (let start = 0; start < totalPages; start += per) {
    const end = Math.min(start + per, totalPages);
    const doc = await PDFDocument.create();
    const indices = Array.from({ length: end - start }, (_, i) => start + i);
    const copied = await doc.copyPages(src, indices);
    copied.forEach((p) => doc.addPage(p));
    const out = await doc.save();
    chunks.push({
      base64: uint8ToBase64(out),
      mediaType: "application/pdf",
      fromPage: start + 1,
      toPage: end,
      totalPages,
    });
  }

  return chunks;
}

function invoiceKey(inv: ParsedInvoice): string {
  const num = (inv.invoice_number || "").trim().toLowerCase();
  const sup = (inv.supplier || "").trim().toLowerCase();
  if (num) return `n:${num}|s:${sup}`;
  return `s:${sup}|d:${inv.invoice_date || ""}`;
}

function itemKey(it: ParsedInvoice["items"][number]): string {
  return `${it.description.trim().toLowerCase()}|${it.qty}|${it.line_total}`;
}

/** Merge parse results from multiple PDF page chunks into distinct invoices. */
export function mergeParsedInvoiceChunks(chunkResults: ParsedInvoice[][]): ParsedInvoice[] {
  const map = new Map<string, ParsedInvoice>();

  for (const invoices of chunkResults) {
    for (const inv of invoices) {
      if (!inv.items?.length && !inv.charges?.length) continue;
      const key = invoiceKey(inv);
      const existing = map.get(key);
      if (!existing) {
        map.set(key, {
          ...inv,
          items: [...(inv.items || [])],
          charges: [...(inv.charges || [])],
        });
        continue;
      }

      const seenItems = new Set(existing.items.map(itemKey));
      for (const it of inv.items || []) {
        const k = itemKey(it);
        if (!seenItems.has(k)) {
          existing.items.push(it);
          seenItems.add(k);
        }
      }

      const seenCharges = new Set(
        existing.charges.map((c) => `${c.kind}|${c.label}|${c.amount}`),
      );
      for (const ch of inv.charges || []) {
        const k = `${ch.kind}|${ch.label}|${ch.amount}`;
        if (!seenCharges.has(k)) {
          existing.charges.push(ch);
          seenCharges.add(k);
        }
      }

      existing.supplier = existing.supplier || inv.supplier;
      existing.invoice_number = existing.invoice_number || inv.invoice_number;
      existing.invoice_date = existing.invoice_date || inv.invoice_date;
      existing.ship_from = existing.ship_from || inv.ship_from;
      existing.ship_to = existing.ship_to || inv.ship_to;
      if (inv.goods_subtotal != null && (existing.goods_subtotal == null || inv.goods_subtotal > existing.goods_subtotal)) {
        existing.goods_subtotal = inv.goods_subtotal;
      }
      if (inv.invoice_total != null && (existing.invoice_total == null || inv.invoice_total > existing.invoice_total)) {
        existing.invoice_total = inv.invoice_total;
      }
    }
  }

  return [...map.values()].filter((inv) => inv.items.length > 0);
}
