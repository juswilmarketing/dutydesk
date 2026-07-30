export function InfoBanner({
  children,
  tone = "info",
  className = "",
  onDismiss,
}: {
  children: React.ReactNode;
  tone?: "info" | "warn" | "error";
  className?: string;
  onDismiss?: () => void;
}) {
  const tones = {
    info: "notif-info",
    warn: "notif-warn",
    error: "notif-error",
  };
  return (
    <div className={`flex items-start justify-between gap-3 ${tones[tone]} ${className}`}>
      <div>{children}</div>
      {onDismiss && (
        <button type="button" onClick={onDismiss} className="border-none bg-transparent p-0 text-inherit opacity-70 hover:opacity-100">
          ✕
        </button>
      )}
    </div>
  );
}

export function DividerLabel({ children }: { children: React.ReactNode }) {
  return <div className="divider-label">{children}</div>;
}

export function EmptyState({
  icon,
  title,
  action,
}: {
  icon: string;
  title: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon">{icon}</div>
      <p className="text-sm font-medium" style={{ color: "var(--text)" }}>
        {title}
      </p>
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
