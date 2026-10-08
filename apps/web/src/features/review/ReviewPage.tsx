import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type {
  LineItem,
  LiquidProductProfile,
  ProductQuestionAnswer,
  ProductResolution,
  ProductResolverCandidate,
} from "@pas/shared-types";
import { useInvoiceStore } from "@/stores/invoice-store";
import { useInvoiceProcessor } from "@/hooks/useInvoiceProcessor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { buildTariffReportHtml, openPrintWindow } from "@/lib/export/tariff-report";
import { exportInvoiceCsv } from "@/lib/export/csv";
import { EmptyState, InfoBanner } from "@/components/ui/banners";
import { PageHeader, PageLayout } from "@/components/layout/PageHeader";
import { cn } from "@/lib/cn";
import { useAuthStore } from "@/stores/auth-store";
import { clerkDisplayName } from "@/lib/clerk";
import { checkInvoiceTotals } from "@/lib/invoice-totals";
import { InvoiceTotalsReviewModal } from "@/components/invoice/InvoiceTotalsReviewModal";
import { lineItemValue } from "@/lib/invoice-charges";
import { useWorkflowStore } from "@/stores/workflow-store";
import { WorkflowProgress } from "@/components/workflow/WorkflowProgress";
import { getWorkflowStages } from "@/lib/workflow-pipeline";
import { ClassificationWorkspace } from "./ClassificationWorkspace";

export function ReviewPage() {
  const invoices = useInvoiceStore((s) => s.invoices);
  const activeInvId = useInvoiceStore((s) => s.activeInvId);
  const setActiveInvId = useInvoiceStore((s) => s.setActiveInvId);
  const setInvoices = useInvoiceStore((s) => s.setInvoices);
  const [showTotalsModal, setShowTotalsModal] = useState(false);
  const [, setItemReview] = useState<Record<number, "approved" | "flagged">>({});
  const [updatingLine, setUpdatingLine] = useState<number | null>(null);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const taxInputs = useWorkflowStore((s) => s.taxInputs);
  const taxLog = useWorkflowStore((s) => s.taxLog);
  const approvedTaxSheet = useWorkflowStore((s) => s.approvedTaxSheet);
  const {
    saveLearnedPair,
    reanalyzeLine,
    persistProductLearning,
  } = useInvoiceProcessor();
  const user = useAuthStore((s) => s.user);
  const clerkName = clerkDisplayName(user);
  const navigate = useNavigate();
  const activeInv = invoices.find((inv) => inv.id === activeInvId) || invoices[0] || null;
  const totalsCheck = activeInv ? checkInvoiceTotals(activeInv) : null;

  const editItem = (
    invId: number,
    itemId: number,
    field: keyof LineItem,
    value: LineItem[keyof LineItem],
  ) => {
    setInvoices((p) =>
      p.map((inv) => {
        if (inv.id !== invId) return inv;
        const items = inv.items.map((it) => {
          if (it.id !== itemId) return it;
          const next = { ...it, [field]: value } as LineItem;
          if (field === "qty" || field === "price") {
            const qty = field === "qty" ? Number(value) || 0 : it.qty;
            const price = field === "price" ? Number(value) || 0 : it.price || 0;
            next.line_total = Math.round(qty * price * 100) / 100;
          }
          return next;
        });
        const updated = { ...inv, items };
        return { ...updated, meta: { ...updated.meta, totalsMismatch: checkInvoiceTotals(updated).mismatch } };
      }),
    );
  };

  /** Apply multiple line fields in one store update so Apply cannot partially overwrite itself. */
  const patchItem = (invId: number, itemId: number, patch: Partial<LineItem>) => {
    setInvoices((p) =>
      p.map((inv) => {
        if (inv.id !== invId) return inv;
        const items = inv.items.map((it) => {
          if (it.id !== itemId) return it;
          const next = { ...it, ...patch } as LineItem;
          if (patch.qty != null || patch.price != null) {
            next.line_total = Math.round((next.qty || 0) * (next.price || 0) * 100) / 100;
          }
          return next;
        });
        const updated = { ...inv, items };
        return { ...updated, meta: { ...updated.meta, totalsMismatch: checkInvoiceTotals(updated).mismatch } };
      }),
    );
  };

  const setLineAnswers = (invId: number, itemId: number, answers: ProductQuestionAnswer[]) => {
    setInvoices((p) =>
      p.map((inv) =>
        inv.id === invId
          ? {
              ...inv,
              items: inv.items.map((it) => (it.id === itemId ? { ...it, question_answers: answers } : it)),
            }
          : inv,
      ),
    );
  };

  const setLiquidProfile = (invId: number, itemId: number, profile: LiquidProductProfile) => {
    setInvoices((p) =>
      p.map((inv) =>
        inv.id === invId
          ? {
              ...inv,
              items: inv.items.map((it) =>
                it.id === itemId ? { ...it, liquid_profile: profile, liquid_requires_review: false } : it,
              ),
            }
          : inv,
      ),
    );
  };

  const setProductResolution = (
    invId: number,
    itemId: number,
    resolution: ProductResolution,
    candidate: ProductResolverCandidate,
    confirmed: boolean,
  ) => {
    setInvoices((previous) =>
      previous.map((invoice) =>
        invoice.id === invId
          ? {
              ...invoice,
              items: invoice.items.map((item) =>
                item.id === itemId
                  ? {
                      ...item,
                      product_resolution: resolution,
                      canonical_product_id: candidate.canonicalProductId,
                      product_confirmed: confirmed,
                      identity_unresolved: !confirmed,
                      product_profile: {
                        ...(item.product_profile || {
                          productName: candidate.canonicalName,
                          normalizedName: candidate.canonicalName.toLowerCase(),
                          industry: candidate.industry,
                          industryCode: null,
                          productFamily: candidate.productFamily,
                          productType: candidate.canonicalName,
                          material: candidate.typicalMaterials[0] || null,
                          composition: null,
                          primaryFunction: candidate.commonUses[0] || null,
                          primaryUse: candidate.commonUses[0] || null,
                          commercialUse: false,
                          consumerUse: true,
                          brand: null,
                          model: item.model_number || null,
                          partNumber: item.part_number || null,
                          supplier: invoice.meta.supplier || null,
                          countryOfOrigin: null,
                          gender: null,
                          ageGroup: null,
                          food: false,
                          chemical: false,
                          medical: false,
                          electrical: false,
                          vehicle: false,
                          construction: false,
                          textile: false,
                          footwear: false,
                          machine: false,
                          tool: false,
                          hazardous: false,
                          fragile: false,
                          temperatureControlled: false,
                          attributes: {},
                        }),
                        productName: candidate.canonicalName,
                        normalizedName: candidate.canonicalName.toLowerCase(),
                        productFamily: candidate.productFamily,
                        productType: candidate.canonicalName,
                        industry: candidate.industry,
                        material:
                          item.product_profile?.material ||
                          candidate.typicalMaterials[0] ||
                          "Unknown",
                        primaryUse:
                          item.product_profile?.primaryUse ||
                          candidate.commonUses[0] ||
                          null,
                        primaryFunction:
                          item.product_profile?.primaryFunction ||
                          candidate.commonUses[0] ||
                          null,
                      },
                    }
                  : item,
              ),
            }
          : invoice,
      ),
    );
  };

  const deleteInvoice = (invId: number) => {
    const remaining = invoices.filter((inv) => inv.id !== invId);
    setInvoices(() => remaining);
    if (activeInvId === invId) setActiveInvId(remaining.length ? remaining[remaining.length - 1].id : null);
  };

  if (!invoices.length) {
    return (
      <EmptyState
        icon="📄"
        title="No invoices loaded yet"
        action={<Button onClick={() => navigate("/upload")}>Upload Invoice →</Button>}
      />
    );
  }

  const invId = activeInv?.id;
  const subtotal = activeInv?.items.reduce((s, i) => s + lineItemValue(i), 0) || 0;
  const stages = getWorkflowStages(activeInv, taxInputs, taxLog, approvedTaxSheet);

  return (
    <PageLayout>
      <PageHeader
        icon="📋"
        title="Classification"
        description="AI classification assistant — review suggestions, answer questions, and confirm tariff codes"
        actions={
          <Button onClick={() => navigate("/duties-taxes")} style={{ background: "var(--accent2)" }}>
            Continue to Duties &amp; Taxes →
          </Button>
        }
      />

      <WorkflowProgress stages={stages} />

      <div className="grid gap-4 xl:grid-cols-[minmax(200px,240px)_1fr]">
        <aside>
          <div className="dd-label mb-3">Invoices</div>
          {invoices.map((inv) => (
            <button
              key={inv.id}
              type="button"
              onClick={() => setActiveInvId(inv.id)}
              className={cn(
                "mb-2 w-full rounded-lg border px-3 py-2 text-left text-sm",
                inv.id === invId ? "border-[var(--accent)]" : "border-[var(--border)]",
              )}
              style={{ background: inv.id === invId ? "var(--surface2)" : "var(--surface)" }}
            >
              <div className="truncate font-medium">{inv.meta.supplier || inv.filename}</div>
              <div className="text-[10px] dd-text-muted">{inv.items.length} lines</div>
            </button>
          ))}
          {activeInv && (
            <Button variant="ghost" className="mt-2 w-full text-xs" onClick={() => deleteInvoice(activeInv.id)}>
              Remove invoice
            </Button>
          )}
          {totalsCheck?.mismatch && !activeInv?.meta.totalsReviewed && (
            <InfoBanner tone="warn" className="mt-3 text-[11px]">
              Invoice totals mismatch.{" "}
              <button type="button" className="underline" onClick={() => setShowTotalsModal(true)}>
                Review
              </button>
            </InfoBanner>
          )}
        </aside>

        {activeInv && invId != null && (
          <div className="min-w-0">
            <Card className="mb-3 overflow-hidden">
              <CardHeader>
                <span className="text-base font-bold">{activeInv.meta.supplier || activeInv.filename}</span>
                <Badge tone="blue">{activeInv.items.length} items</Badge>
                <div className="ml-auto text-right text-[11px] dd-text-muted">
                  US${subtotal.toFixed(2)} CIF
                </div>
              </CardHeader>

              <ClassificationWorkspace
                items={activeInv.items}
                invId={invId}
                supplierName={activeInv.meta.supplier}
                consigneeName={activeInv.meta.to || undefined}
                shipmentId={activeInv.meta.sourceJobId}
                updatingLine={updatingLine}
                selectedIds={selectedIds}
                setSelectedIds={setSelectedIds}
                setItemReview={setItemReview}
                editItem={editItem}
                patchItem={patchItem}
                setLineAnswers={setLineAnswers}
                setLiquidProfile={setLiquidProfile}
                setProductResolution={setProductResolution}
                reanalyzeLine={reanalyzeLine}
                saveLearnedPair={saveLearnedPair}
                persistProductLearning={persistProductLearning}
                onNavigateSupplierHistory={() => navigate("/admin/supplier-history")}
                onNavigateTariffSearch={() => navigate("/manual")}
                setUpdatingLine={setUpdatingLine}
              />

              <div
                className="flex justify-end gap-8 rounded-b-xl px-5 py-4 text-white"
                style={{ background: "linear-gradient(90deg, var(--accent2), #6b0000)" }}
              >
                <div className="text-right">
                  <div className="text-xs font-semibold uppercase tracking-widest text-white/55">Items</div>
                  <div className="font-mono text-lg font-medium text-white">{activeInv.items.length}</div>
                </div>
                <div className="text-right">
                  <div className="text-xs font-semibold uppercase tracking-widest text-white/55">Total (USD)</div>
                  <div className="font-mono text-lg font-medium text-white">US${subtotal.toFixed(2)}</div>
                </div>
              </div>
            </Card>

            <div className="flex items-center justify-end gap-2">
              <Button
                variant="ghost"
                onClick={() =>
                  setInvoices((p) => p.map((inv) => (inv.id === invId ? { ...inv, items: [] } : inv)))
                }
              >
                🗑 Clear Items
              </Button>
              <Button variant="secondary" onClick={() => exportInvoiceCsv(activeInv, clerkName)}>
                📄 Export CSV
              </Button>
              <Button variant="green" onClick={() => openPrintWindow(buildTariffReportHtml(activeInv, clerkName))}>
                📋 Export Report
              </Button>
            </div>

            <InfoBanner tone="info" className="mt-3.5 text-[11.5px]">
              Duty Desk is an <strong>AI classification assistant</strong> — apply suggestions only when
              confidence, domain fit, and required answers look right. Confirmed decisions are saved for
              future supplier/SKU matches.
            </InfoBanner>

            {showTotalsModal && activeInv && (
              <InvoiceTotalsReviewModal
                invoice={activeInv}
                onReviewed={() =>
                  setInvoices((p) =>
                    p.map((inv) =>
                      inv.id === activeInv.id ? { ...inv, meta: { ...inv.meta, totalsReviewed: true } } : inv,
                    ),
                  )
                }
                onClose={() => setShowTotalsModal(false)}
              />
            )}
          </div>
        )}
      </div>
    </PageLayout>
  );
}
