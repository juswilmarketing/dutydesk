import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { AttributeAnalyticsSummary } from "@pas/shared-types";
import { useInvoiceStore } from "@/stores/invoice-store";
import { useWorkflowStore } from "@/stores/workflow-store";
import { useAuthStore } from "@/stores/auth-store";
import { PageHeader, PageLayout } from "@/components/layout/PageHeader";
import { DashboardCard } from "@/components/workflow/DashboardCard";
import { WorkflowProgress } from "@/components/workflow/WorkflowProgress";
import { Button } from "@/components/ui/button";
import { dashboardMetrics, getWorkflowStages } from "@/lib/workflow-pipeline";
import { classificationAccuracyEstimate, loadClassificationMetrics } from "@/lib/classification-metrics";
import { Card } from "@/components/ui/card";
import { api } from "@/lib/api-client";

export function DashboardPage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const invoices = useInvoiceStore((s) => s.invoices);
  const activeInvId = useInvoiceStore((s) => s.activeInvId);
  const taxInputs = useWorkflowStore((s) => s.taxInputs);
  const taxLog = useWorkflowStore((s) => s.taxLog);
  const approvedTaxSheet = useWorkflowStore((s) => s.approvedTaxSheet);
  const [attrAnalytics, setAttrAnalytics] = useState<AttributeAnalyticsSummary | null>(null);

  const activeInv = invoices.find((i) => i.id === activeInvId) || invoices[0] || null;
  const metrics = dashboardMetrics(invoices, taxLog, taxInputs);
  const classMetrics = loadClassificationMetrics();
  const accuracyEst = classificationAccuracyEstimate(classMetrics);
  const stages = getWorkflowStages(activeInv, taxInputs, taxLog, approvedTaxSheet);

  useEffect(() => {
    if (user?.role !== "admin") return;
    api.getAttributeAnalytics().then(setAttrAnalytics).catch(() => setAttrAnalytics(null));
  }, [user?.role]);

  return (
    <PageLayout>
      <PageHeader
        icon="📊"
        title="Dashboard"
        description="Customs worksheet preparation — track classification, duties, and FlowBoard handoff"
        actions={
          <Button onClick={() => navigate("/upload")} style={{ background: "var(--accent2)" }}>
            Upload Supplier Invoice
          </Button>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <DashboardCard
          title="Pending Classification"
          value={metrics.pendingClassification}
          subtitle="Invoices needing tariff review"
          tone="gold"
          onClick={() => navigate("/classification")}
        />
        <DashboardCard
          title="Ready for Worksheet"
          value={metrics.readyWorksheet}
          subtitle="Classification complete"
          tone="blue"
          onClick={() => navigate("/worksheet")}
        />
        <DashboardCard
          title="Ready for FlowBoard"
          value={metrics.readyFlowboard}
          subtitle="Worksheet prepared, not sent"
          tone="blue"
          onClick={() => navigate("/worksheet")}
        />
        <DashboardCard
          title="Sent to FlowBoard"
          value={metrics.sentFlowboard}
          subtitle="Customer comms managed in FlowBoard"
          tone="green"
          onClick={() => navigate("/flowboard")}
        />
        <DashboardCard
          title="Failed Exports"
          value={metrics.failedExports}
          subtitle="Sync or export errors"
          tone="red"
          onClick={() => navigate("/flowboard")}
        />
      </div>

      {classMetrics.totalLines > 0 && (
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <DashboardCard
            title="Supplier History"
            value={classMetrics.supplierHistoryHits}
            subtitle="Lines matched from supplier memory"
            tone="green"
            onClick={() => navigate("/admin/supplier-history")}
          />
          <DashboardCard
            title="Learning Rules"
            value={classMetrics.learnedRuleHits}
            subtitle="Lines matched from learned rules"
            tone="blue"
            onClick={() => navigate("/learned")}
          />
          <DashboardCard
            title="AI Classified"
            value={classMetrics.aiClassified}
            subtitle="Unresolved items sent to AI"
            tone="gold"
          />
          <DashboardCard
            title="Tokens Saved (est.)"
            value={classMetrics.tokensSavedEstimate}
            subtitle="By skipping matched lines"
            tone="blue"
          />
          <DashboardCard
            title="Manual Review"
            value={classMetrics.manualReview}
            subtitle="Fuzzy / low-confidence items"
            tone="gold"
            onClick={() => navigate("/classification")}
          />
          <DashboardCard
            title="Auto-Classify Rate"
            value={`${accuracyEst}%`}
            subtitle="Supplier + rules + DB vs total"
            tone="green"
          />
        </div>
      )}

      {attrAnalytics && (
        <div className="mt-5">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-sm font-bold">Attribute Library Analytics</div>
            <Button
              variant="ghost"
              className="h-7 px-2 text-xs"
              onClick={() => navigate("/admin/attribute-library")}
            >
              Open Attribute Library
            </Button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <DashboardCard
              title="Avg Questions / Classification"
              value={attrAnalytics.average_questions_per_classification}
              subtitle={`${attrAnalytics.total_asked} questions asked`}
              tone="gold"
            />
            <DashboardCard
              title="Question Reduction"
              value={`${attrAnalytics.question_reduction_pct}%`}
              subtitle="Share of attributes auto-inferred vs asked"
              tone="green"
            />
            <DashboardCard
              title="Auto-Inferred Attributes"
              value={attrAnalytics.total_inferred}
              subtitle="From OCR, dictionaries, and learning"
              tone="blue"
            />
            <DashboardCard
              title="Clerk Answers Saved"
              value={attrAnalytics.total_answered}
              subtitle="Feeds attribute learning cache"
              tone="blue"
            />
            <DashboardCard
              title="Confidence Improvements"
              value={attrAnalytics.confidence_improvements}
              subtitle="Inferred attributes avoiding questions"
              tone="green"
            />
            <DashboardCard
              title="Accuracy Signal"
              value={attrAnalytics.classification_accuracy_improvements}
              subtitle="Answered attributes reinforcing future runs"
              tone="green"
            />
          </div>
          {(attrAnalytics.most_asked.length > 0 || attrAnalytics.missing_attributes.length > 0) && (
            <div className="mt-3 grid gap-3 md:grid-cols-3">
              <Card className="p-3 text-sm">
                <div className="mb-2 font-semibold">Most Asked Questions</div>
                <ul className="space-y-1 dd-text-muted">
                  {attrAnalytics.most_asked.slice(0, 6).map((r) => (
                    <li key={r.attribute_key}>
                      {r.attribute_key}: {r.count}
                    </li>
                  ))}
                  {!attrAnalytics.most_asked.length && <li>None yet</li>}
                </ul>
              </Card>
              <Card className="p-3 text-sm">
                <div className="mb-2 font-semibold">Missing Attributes</div>
                <ul className="space-y-1 dd-text-muted">
                  {attrAnalytics.missing_attributes.slice(0, 6).map((r) => (
                    <li key={r.attribute_key}>
                      {r.attribute_key}: {r.count}
                    </li>
                  ))}
                  {!attrAnalytics.missing_attributes.length && <li>None yet</li>}
                </ul>
              </Card>
              <Card className="p-3 text-sm">
                <div className="mb-2 font-semibold">Auto-Inferred</div>
                <ul className="space-y-1 dd-text-muted">
                  {attrAnalytics.auto_inferred.slice(0, 6).map((r) => (
                    <li key={r.attribute_key}>
                      {r.attribute_key}: {r.count}
                    </li>
                  ))}
                  {!attrAnalytics.auto_inferred.length && <li>None yet</li>}
                </ul>
              </Card>
            </div>
          )}
        </div>
      )}

      {activeInv && (
        <Card className="dd-card mt-5 border-none p-4 shadow-none">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-sm font-bold" style={{ color: "var(--text)" }}>
                Active job: {activeInv.meta.supplier || activeInv.filename}
              </div>
              <div className="text-xs" style={{ color: "var(--text2)" }}>
                {activeInv.items.length} line items
                {taxInputs.worksheetNum ? ` · Worksheet ${taxInputs.worksheetNum}` : ""}
              </div>
            </div>
            <Button variant="secondary" className="text-xs" onClick={() => navigate("/classification")}>
              Open Classification
            </Button>
          </div>
          <WorkflowProgress stages={stages} />
        </Card>
      )}

      {!invoices.length && (
        <Card className="dd-card mt-5 border-none p-6 text-center shadow-none">
          <div className="mb-2 text-4xl">📄</div>
          <div className="font-semibold">No supplier invoices loaded</div>
          <p className="mt-1 text-sm" style={{ color: "var(--text2)" }}>
            Upload a supplier invoice to extract line items and begin classification.
          </p>
          <Button className="mt-4" onClick={() => navigate("/upload")} style={{ background: "var(--accent2)" }}>
            Upload Supplier Invoice
          </Button>
        </Card>
      )}
    </PageLayout>
  );
}
