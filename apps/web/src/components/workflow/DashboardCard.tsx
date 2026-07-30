import { cn } from "@/lib/cn";

export function DashboardCard({
  title,
  value,
  subtitle,
  tone = "default",
  onClick,
}: {
  title: string;
  value: number | string;
  subtitle?: string;
  tone?: "default" | "blue" | "green" | "gold" | "red";
  onClick?: () => void;
}) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={cn(
        "dd-metric-card text-left",
        onClick && "cursor-pointer transition hover:shadow-md",
        tone !== "default" && `dd-metric-card-${tone}`,
      )}
    >
      <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--text2)" }}>
        {title}
      </div>
      <div className="mt-1 font-mono text-3xl font-bold" style={{ color: "var(--text)" }}>
        {value}
      </div>
      {subtitle && (
        <div className="mt-1 text-xs" style={{ color: "var(--text2)" }}>
          {subtitle}
        </div>
      )}
    </Tag>
  );
}
