import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/cn";
import type { WorkflowStageStatus } from "@pas/shared-types";
import { StageStatusBadge } from "./StatusBadge";

export interface WorkflowProgressStage {
  id: string;
  label: string;
  path: string;
  status: WorkflowStageStatus;
}

export function WorkflowProgress({ stages }: { stages: WorkflowProgressStage[] }) {
  const navigate = useNavigate();

  return (
    <div className="dd-workflow-progress mb-5 overflow-x-auto">
      <div className="flex min-w-[720px] items-start gap-0">
        {stages.map((stage, i) => (
          <div key={stage.id} className="flex flex-1 min-w-0 items-start">
            <button
              type="button"
              onClick={() => navigate(stage.path)}
              className={cn(
                "dd-workflow-step group flex flex-1 flex-col items-center gap-1.5 border-none bg-transparent px-1 py-0 text-center",
                stage.status === "complete" && "dd-workflow-step-done",
                stage.status === "in_progress" && "dd-workflow-step-active",
                stage.status === "failed" && "dd-workflow-step-failed",
              )}
            >
              <span className="dd-workflow-step-dot" aria-hidden />
              <span className="text-[11px] font-semibold leading-tight group-hover:underline" style={{ color: "var(--text)" }}>
                {stage.label}
              </span>
              <StageStatusBadge status={stage.status} />
            </button>
            {i < stages.length - 1 && (
              <div
                className={cn(
                  "dd-workflow-connector mt-3 h-0.5 flex-1 min-w-[12px]",
                  stage.status === "complete" && "dd-workflow-connector-done",
                )}
                aria-hidden
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
