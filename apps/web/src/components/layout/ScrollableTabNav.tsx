import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";

export function ScrollableTabNav({
  children,
  className,
  activeKey,
  "aria-label": ariaLabel = "Main navigation",
}: {
  children: ReactNode;
  className?: string;
  activeKey?: string;
  "aria-label"?: string;
}) {
  const scrollRef = useRef<HTMLElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const updateScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const maxScroll = el.scrollWidth - el.clientWidth;
    setCanScrollLeft(el.scrollLeft > 4);
    setCanScrollRight(maxScroll > 4 && el.scrollLeft < maxScroll - 4);
  }, []);

  useEffect(() => {
    updateScroll();
    const el = scrollRef.current;
    if (!el) return;

    el.addEventListener("scroll", updateScroll, { passive: true });
    const observer = new ResizeObserver(updateScroll);
    observer.observe(el);
    window.addEventListener("resize", updateScroll);

    return () => {
      el.removeEventListener("scroll", updateScroll);
      observer.disconnect();
      window.removeEventListener("resize", updateScroll);
    };
  }, [updateScroll, activeKey, children]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !activeKey) return;
    const active = el.querySelector<HTMLElement>(`[data-tab-key="${activeKey}"]`);
    active?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
    const t = window.setTimeout(updateScroll, 300);
    return () => window.clearTimeout(t);
  }, [activeKey, updateScroll]);

  const scrollBy = (direction: -1 | 1) => {
    scrollRef.current?.scrollBy({ left: direction * 220, behavior: "smooth" });
  };

  return (
    <div className={cn("dd-tabs-wrap", className)}>
      {canScrollLeft && (
        <>
          <div className="dd-tabs-fade dd-tabs-fade-left" aria-hidden />
          <button
            type="button"
            className="dd-tabs-scroll-btn dd-tabs-scroll-left"
            onClick={() => scrollBy(-1)}
            aria-label="Scroll tabs left"
          >
            <ChevronLeft size={18} />
          </button>
        </>
      )}

      <nav ref={scrollRef} className="dd-tabs" aria-label={ariaLabel}>
        {children}
      </nav>

      {canScrollRight && (
        <>
          <div className="dd-tabs-fade dd-tabs-fade-right" aria-hidden />
          <button
            type="button"
            className="dd-tabs-scroll-btn dd-tabs-scroll-right"
            onClick={() => scrollBy(1)}
            aria-label="Scroll tabs right"
          >
            <ChevronRight size={18} />
          </button>
        </>
      )}

      {(canScrollLeft || canScrollRight) && (
        <div className="dd-tabs-scroll-hint" aria-hidden>
          Scroll for more tabs →
        </div>
      )}
    </div>
  );
}
