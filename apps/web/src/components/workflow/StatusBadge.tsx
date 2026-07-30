import { cn } from "@/lib/cn";
import type {
  DutyDeskJobStatus,
  FlowBoardQueueStatus,
  InvoiceQueueStatus,
  WorkflowStageStatus,
} from "@pas/shared-types";
import { dutyDeskStatusLabel, flowBoardStatusLabel, invoiceQueueLabel } from "@/lib/workflow-pipeline";

const STAGE_LABELS: Record<WorkflowStageStatus, string> = {
  not_started: "Not Started",
  in_progress: "In Progress",
  needs_review: "Needs Review",
  complete: "Complete",
  failed: "Failed",
};

type Tone = "green" | "yellow" | "red" | "blue" | "default";

function toneClass(tone: Tone) {
  const map: Record<Tone, string> = {
    green: "dd-status-badge-green",
    yellow: "dd-status-badge-yellow",
    red: "dd-status-badge-red",
    blue: "dd-status-badge-blue",
    default: "dd-status-badge-default",
  };
  return map[tone];
}

function stageTone(status: WorkflowStageStatus): Tone {
  if (status === "complete") return "green";
  if (status === "failed") return "red";
  if (status === "needs_review") return "yellow";
  if (status === "in_progress") return "blue";
  return "default";
}

function queueTone(status: InvoiceQueueStatus): Tone {
  if (status === "sent_to_flowboard" || status === "worksheet_ready") return "green";
  if (status === "needs_review") return "yellow";
  if (status === "extracting") return "blue";
  return "default";
}

function fbTone(status: FlowBoardQueueStatus): Tone {
  if (status === "approved" || status === "delivered" || status === "sent" || status === "sent_via_email") {
    return "green";
  }
  if (status === "failed") return "red";
  if (status === "awaiting_approval" || status === "customer_viewed" || status === "pending_send") {
    return "yellow";
  }
  return "blue";
}

function jobTone(status: DutyDeskJobStatus): Tone {
  if (status === "sent_to_flowboard" || status === "completed_directly") return "green";
  if (status === "failed_flowboard_send") return "red";
  if (status === "worksheet_ready" || status === "awaiting_completion") return "yellow";
  if (status === "sending_to_flowboard" || status === "classification_in_progress") return "blue";
  return "default";
}

export function StageStatusBadge({ status }: { status: WorkflowStageStatus }) {
  return (
    <span className={cn("dd-status-badge", toneClass(stageTone(status)))}>
      {STAGE_LABELS[status]}
    </span>
  );
}

export function InvoiceQueueBadge({ status }: { status: InvoiceQueueStatus }) {
  return (
    <span className={cn("dd-status-badge", toneClass(queueTone(status)))}>
      {invoiceQueueLabel(status)}
    </span>
  );
}

export function FlowBoardStatusBadge({ status }: { status: FlowBoardQueueStatus }) {
  return (
    <span className={cn("dd-status-badge", toneClass(fbTone(status)))}>
      {flowBoardStatusLabel(status)}
    </span>
  );
}

export function DutyDeskJobStatusBadge({ status }: { status: DutyDeskJobStatus }) {
  return (
    <span className={cn("dd-status-badge", toneClass(jobTone(status)))}>
      {dutyDeskStatusLabel(status)}
    </span>
  );
}

export function ConfidenceBadge({ tone, label }: { tone: "green" | "yellow" | "red"; label: string }) {
  return (
    <span className={cn("dd-status-badge", toneClass(tone))}>
      {label}
    </span>
  );
}
