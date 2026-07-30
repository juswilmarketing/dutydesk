import { cn } from "@/lib/cn";
import type { HTMLAttributes } from "react";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("dd-card", className)} {...props} />;
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 border-b px-5 py-4 text-white",
        className,
      )}
      style={{
        borderColor: "var(--border)",
        background: "linear-gradient(90deg, var(--accent2), #6b0000)",
      }}
      {...props}
    />
  );
}
