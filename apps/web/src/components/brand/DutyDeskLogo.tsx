import { DUTY_DESK_BRAND, DUTY_DESK_LOGO_SRC } from "@/lib/brand";
import { cn } from "@/lib/cn";

type DutyDeskLogoProps = {
  className?: string;
  /** Preset sizes for common placements. */
  variant?: "header" | "login" | "login-mobile";
  /** Show title + tagline beside the image (header layout). */
  showText?: boolean;
  /** Hide tagline on narrow screens when showText is true. */
  compact?: boolean;
};

const VARIANT_CLASS: Record<NonNullable<DutyDeskLogoProps["variant"]>, string> = {
  header: "h-11 w-auto sm:h-12 md:h-[3.25rem] lg:h-14",
  login: "w-[min(420px,96%)] h-auto sm:w-[min(560px,92%)]",
  "login-mobile": "w-[min(340px,94vw)] h-auto",
};

export function DutyDeskLogo({
  className,
  variant,
  showText = false,
  compact = false,
}: DutyDeskLogoProps) {
  const imageClass = cn(
    "block h-auto w-auto shrink-0 object-contain object-left",
    variant ? VARIANT_CLASS[variant] : undefined,
    className,
  );

  if (!showText) {
    return (
      <img
        src={DUTY_DESK_LOGO_SRC}
        alt={`${DUTY_DESK_BRAND.name} — ${DUTY_DESK_BRAND.tagline}`}
        className={imageClass}
      />
    );
  }

  return (
    <div className={cn("flex min-w-0 items-center gap-3", className)}>
      <img
        src={DUTY_DESK_LOGO_SRC}
        alt=""
        aria-hidden
        className="h-10 w-auto shrink-0 object-contain sm:h-11"
      />
      <div className="min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="text-lg font-bold tracking-tight sm:text-xl" style={{ color: "var(--header-text)" }}>
            {DUTY_DESK_BRAND.name}
          </span>
          <span className="text-[10px] font-medium sm:text-xs" style={{ color: "var(--header-muted)" }}>
            {DUTY_DESK_BRAND.version}
          </span>
        </div>
        <div
          className={cn(
            "truncate text-xs uppercase tracking-wider sm:text-sm",
            compact && "header-title-sub",
          )}
          style={{ color: "var(--header-muted)" }}
        >
          {DUTY_DESK_BRAND.tagline}
        </div>
      </div>
    </div>
  );
}
