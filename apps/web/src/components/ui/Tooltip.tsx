import { cn } from "@/lib/cn";
import type { ReactNode } from "react";

interface TooltipProps {
  content: string;
  children: ReactNode;
  side?: "top" | "bottom";
  className?: string;
  wide?: boolean;
}

/** Hover/focus tooltip — wrap any control or label. */
export function Tooltip({ content, children, side = "top", className, wide }: TooltipProps) {
  return (
    <span className={cn("dd-tooltip-wrap", className)}>
      {children}
      <span
        className={cn("dd-tooltip", side === "bottom" && "dd-tooltip-bottom", wide && "dd-tooltip-wide")}
        role="tooltip"
      >
        {content}
      </span>
    </span>
  );
}

/** Small ? icon that shows a tooltip on hover — use beside labels. */
export function HelpTip({ content, className }: { content: string; className?: string }) {
  return (
    <Tooltip content={content} className={className}>
      <button
        type="button"
        className="dd-help-icon"
        tabIndex={0}
        aria-label="More information"
        onClick={(e) => e.preventDefault()}
      >
        ?
      </button>
    </Tooltip>
  );
}

/** Table header with dotted underline + tooltip. */
export function HeaderTip({ label, tip }: { label: string; tip: string }) {
  return (
    <Tooltip content={tip}>
      <span className="dd-th-tip">{label}</span>
    </Tooltip>
  );
}
