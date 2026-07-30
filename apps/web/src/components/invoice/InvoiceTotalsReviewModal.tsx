import type { Invoice } from "@pas/shared-types";
import { Button } from "@/components/ui/button";
import { checkInvoiceTotals } from "@/lib/invoice-totals";
import { fmtForeign, normalizeCurrency } from "@/lib/currencies";
import { sumLineItems } from "@/lib/invoice-charges";

interface Props {
  invoice: Invoice;
  onReviewed: () => void;
  onClose: () => void;
}

export function InvoiceTotalsReviewModal({ invoice, onReviewed, onClose }: Props) {
  const check = checkInvoiceTotals(invoice);
  const cur = normalizeCurrency(invoice.meta.currency);
  const lineSum = sumLineItems(invoice);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4">
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border p-5 shadow-xl"
        style={{ background: "var(--surface)", borderColor: "var(--border)" }}
      >
        <h2 className="text-lg font-bold" style={{ color: "var(--accent2)" }}>
          Invoice totals need review
        </h2>
        <p className="mt-2 text-[13px] leading-relaxed" style={{ color: "var(--text2)" }}>
          The extracted line items do not match the total printed on{" "}
          <strong>{invoice.meta.supplier || invoice.filename}</strong>. Please verify quantities, unit prices, and
          missing lines before sending tax advice to the consignee.
        </p>

        <div className="mt-4 space-y-2 rounded-lg border p-3 text-[12px]" style={{ borderColor: "var(--border)", background: "var(--surface2)" }}>
          <div className="flex justify-between">
            <span>Line items total</span>
            <span className="font-mono font-semibold">{fmtForeign(lineSum, cur)}</span>
          </div>
          {check.documentGoodsTotal > 0 && (
            <div className="flex justify-between">
              <span>Document goods subtotal</span>
              <span className="font-mono font-semibold">{fmtForeign(check.documentGoodsTotal, cur)}</span>
            </div>
          )}
          {check.documentGrandTotal > 0 && (
            <div className="flex justify-between">
              <span>Document grand total</span>
              <span className="font-mono font-semibold">{fmtForeign(check.documentGrandTotal, cur)}</span>
            </div>
          )}
          {check.chargesInCif > 0 && (
            <div className="flex justify-between">
              <span>Charges (freight, tax, other)</span>
              <span className="font-mono font-semibold">{fmtForeign(check.chargesInCif, cur)}</span>
            </div>
          )}
          <div className="flex justify-between border-t pt-2 font-semibold" style={{ borderColor: "var(--border)", color: "var(--red)" }}>
            <span>Difference</span>
            <span className="font-mono">{fmtForeign(Math.abs(check.difference), cur)}</span>
          </div>
        </div>

        <p className="dd-notif-warn mt-3 text-[11px]">
          If you send tax advice while totals are out of sync, the consignee will be notified that line items and
          invoice totals may not match.
        </p>

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Review line items
          </Button>
          <Button
            onClick={() => {
              onReviewed();
              onClose();
            }}
          >
            I&apos;ve reviewed — continue
          </Button>
        </div>
      </div>
    </div>
  );
}
