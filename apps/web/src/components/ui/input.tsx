import { cn } from "@/lib/cn";
import type { InputHTMLAttributes, LabelHTMLAttributes } from "react";
import { HelpTip } from "@/components/ui/Tooltip";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn("dd-input", className)} {...props} />;
}

interface LabelProps extends LabelHTMLAttributes<HTMLLabelElement> {
  tip?: string;
}

export function Label({ className, tip, children, ...props }: LabelProps) {
  return (
    <label className={cn("dd-label", tip && "dd-label-with-tip", className)} {...props}>
      <span>{children}</span>
      {tip && <HelpTip content={tip} />}
    </label>
  );
}
