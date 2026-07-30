import { PageHeader, PageLayout } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { getFlowBoardAppUrl } from "@/lib/flowboard-client";

export function AdminIntegrationsPage() {
  return (
    <PageLayout>
      <PageHeader
        icon="⚙️"
        title="Integration Settings"
        description="Admin — FlowBoard and external service configuration"
      />
      <Card className="dd-card border-none p-5 shadow-none">
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="font-semibold" style={{ color: "var(--text2)" }}>FlowBoard app URL</dt>
            <dd className="font-mono text-xs mt-1">{getFlowBoardAppUrl()}</dd>
          </div>
          <div>
            <dt className="font-semibold" style={{ color: "var(--text2)" }}>Webhook</dt>
            <dd className="mt-1" style={{ color: "var(--text2)" }}>
              Worksheet status events are posted to FlowBoard when clerks use Send to FlowBoard.
              Ensure FLOWBOARD_INTEGRATION_SECRET matches on both workers.
            </dd>
          </div>
        </dl>
      </Card>
    </PageLayout>
  );
}
