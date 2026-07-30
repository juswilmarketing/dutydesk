import { cn } from "@/lib/cn";

export function Badge({
  children,
  className,
  tone = "default",
}: {
  children: React.ReactNode;
  className?: string;
  tone?: "default" | "green" | "gold" | "blue";
}) {
  const tones = {
    default: { background: "var(--surface2)", color: "var(--text2)", border: "1px solid var(--border)" },
    green: { background: "var(--green-light)", color: "var(--green)" },
    gold: { background: "var(--gold-light)", color: "var(--gold)" },
    blue: { background: "var(--accent-light)", color: "var(--accent)" },
  };
  return (
    <span
      className={cn("inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold sm:text-sm", className)}
      style={tones[tone]}
    >
      {children}
    </span>
  );
}
