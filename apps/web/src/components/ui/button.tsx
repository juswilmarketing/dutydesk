import { cn } from "@/lib/cn";
import type { ButtonHTMLAttributes } from "react";

const variants = {
  primary: "text-white hover:opacity-90",
  secondary: "border hover:opacity-90",
  ghost: "bg-transparent hover:opacity-80",
  green: "text-white hover:opacity-90",
};

const variantStyles: Record<keyof typeof variants, React.CSSProperties> = {
  primary: { background: "var(--accent2)" },
  secondary: {
    background: "var(--surface)",
    borderColor: "var(--border)",
    color: "var(--text)",
  },
  ghost: { color: "var(--text2)" },
  green: { background: "var(--green)" },
};

type Variant = keyof typeof variants;

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
}

export function Button({ className, variant = "primary", style, ...props }: ButtonProps) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-lg border border-transparent px-5 py-2.5 text-base font-semibold transition disabled:cursor-not-allowed disabled:opacity-50",
        variants[variant],
        className,
      )}
      style={{ ...variantStyles[variant], ...style }}
      {...props}
    />
  );
}
