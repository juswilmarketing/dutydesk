import { cn } from "@/lib/cn";
import type { ReactNode } from "react";

interface PageHeaderProps {
  title: string;
  description?: string;
  icon?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

export function PageHeader({ title, description, icon, actions, className }: PageHeaderProps) {
  return (
    <div className={cn("dd-page-header", className)}>
      <div className="flex min-w-0 flex-1 items-start gap-3">
        {icon && (
          <span className="dd-page-header-icon" aria-hidden>
            {icon}
          </span>
        )}
        <div className="min-w-0">
          <h1 className="dd-page-title">{title}</h1>
          {description && <p className="dd-page-desc">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function PageLayout({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("dd-page animate-fade-up", className)}>{children}</div>;
}
