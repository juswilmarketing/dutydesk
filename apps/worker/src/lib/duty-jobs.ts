export const MAX_JOB_STATE_BYTES = 1_500_000;

export type DutyJobStatus = "draft" | "sent" | "abandoned";
export type DutyJobType = "classification_only" | "brokerage_clearance";

const JOB_TYPES: readonly DutyJobType[] = ["classification_only", "brokerage_clearance"];

export type ParsedDraft =
  | { ok: true; stateJson: string; worksheetNum: string | null; consigneeId: string | null; jobId: string | null }
  | { ok: false; status: 400 | 413; error: string };

export type ParsedClose =
  | { ok: true; jobType: DutyJobType | null; worksheetNum: string | null }
  | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function trimmedOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function parseDraftPayload(body: unknown): ParsedDraft {
  if (!isRecord(body) || !isRecord(body.state)) {
    return { ok: false, status: 400, error: "Missing job state" };
  }
  const state = body.state;
  if (!Array.isArray(state.invoices)) {
    return { ok: false, status: 400, error: "Job state must include an invoices array" };
  }
  if (body.jobId !== undefined && body.jobId !== null && typeof body.jobId !== "string") {
    return { ok: false, status: 400, error: "Invalid job id" };
  }
  const stateJson = JSON.stringify(state);
  if (new TextEncoder().encode(stateJson).length > MAX_JOB_STATE_BYTES) {
    return { ok: false, status: 413, error: "Job is too large to save" };
  }
  const taxInputs = isRecord(state.taxInputs) ? state.taxInputs : {};
  return {
    ok: true,
    stateJson,
    worksheetNum: trimmedOrNull(taxInputs.worksheetNum),
    consigneeId: trimmedOrNull(state.activeConsigneeId),
    jobId: trimmedOrNull(body.jobId),
  };
}

export function parseClosePayload(body: unknown): ParsedClose {
  const payload = isRecord(body) ? body : {};
  const rawType = payload.jobType;
  if (rawType !== undefined && rawType !== null && !JOB_TYPES.includes(rawType as DutyJobType)) {
    return { ok: false, error: "Invalid job type" };
  }
  return {
    ok: true,
    jobType: (rawType as DutyJobType | undefined) ?? null,
    worksheetNum: trimmedOrNull(payload.worksheetNum),
  };
}
