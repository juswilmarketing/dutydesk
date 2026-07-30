import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import type { TariffEntry } from "@pas/shared-types";
import { searchTariff } from "@pas/tariff-data";
import { cn } from "@/lib/cn";
import { Input } from "@/components/ui/input";

export function SearchInput({
  value,
  onChange,
  onSelect,
  onEnter,
}: {
  value: string;
  onChange: (v: string) => void;
  onSelect: (r: TariffEntry) => void;
  onEnter: () => void;
}) {
  const [results, setResults] = useState<TariffEntry[]>([]);
  const [show, setShow] = useState(false);
  const [active, setActive] = useState(-1);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const r = searchTariff(value);
    setResults(r);
    setShow(r.length > 0 && value.length >= 2);
    setActive(-1);
  }, [value]);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setShow(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const onKey = (e: React.KeyboardEvent) => {
    if (!show) {
      if (e.key === "Enter") onEnter();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, -1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (active >= 0) {
        onSelect(results[active]);
        setShow(false);
      } else onEnter();
    } else if (e.key === "Escape") setShow(false);
  };

  return (
    <div ref={ref} className="relative min-w-[200px] flex-1">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 dd-text-muted" />
      <Input
        placeholder="Type item description — searches T&T tariff database…"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKey}
        onFocus={() => results.length > 0 && setShow(true)}
        className="pl-9"
        autoFocus
      />
      {show && (
        <div className="dd-dropdown absolute left-0 right-0 top-[calc(100%+6px)] z-50 max-h-[300px]">
          {results.map((r, i) => (
            <button
              key={r.code}
              type="button"
              onMouseDown={() => {
                onSelect(r);
                setShow(false);
              }}
              className={cn("dd-dropdown-item", i === active && "dd-dropdown-item-active")}
            >
              <div className="flex-1 text-sm">{r.desc}</div>
              <div className="text-right">
                <div className="font-mono text-xs font-medium dd-text-green">{r.code}</div>
                <div className="text-[10px] font-semibold dd-text-gold">{r.duty}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
