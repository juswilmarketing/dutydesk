import { useCallback, useRef, useState } from "react";
import { FileUp } from "lucide-react";
import { cn } from "@/lib/cn";

const ACCEPT = ".pdf,application/pdf,image/jpeg,image/jpg,image/png,image/webp";

export function DropZone({
  onFile,
  compact = false,
}: {
  onFile: (file: File) => void;
  compact?: boolean;
}) {
  const [drag, setDrag] = useState(false);
  const ref = useRef<HTMLInputElement>(null);

  const handle = useCallback(
    (f: File | undefined) => {
      if (!f) return;
      const ok =
        ["application/pdf", "image/jpeg", "image/jpg", "image/png", "image/webp"].includes(f.type) ||
        f.name.toLowerCase().endsWith(".pdf");
      if (ok) onFile(f);
    },
    [onFile],
  );

  const dragCls = drag ? "border-[var(--accent)] bg-[var(--accent-light)]" : "border-[var(--border)]";

  if (compact) {
    return (
      <button
        type="button"
        onClick={() => ref.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          handle(e.dataTransfer.files[0]);
        }}
        className={cn(
          "w-full rounded-xl border-2 border-dashed py-5 text-center text-sm font-medium transition hover:border-[var(--accent)] hover:bg-[var(--accent-light)]",
          dragCls,
        )}
        style={{ color: "var(--text2)" }}
      >
        + Add another invoice
        <input ref={ref} type="file" accept={ACCEPT} className="hidden" onChange={(e) => handle(e.target.files?.[0])} />
      </button>
    );
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => ref.current?.click()}
      onKeyDown={(e) => e.key === "Enter" && ref.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        handle(e.dataTransfer.files[0]);
      }}
      className={cn(
        "dd-card cursor-pointer border-2 border-dashed px-8 py-12 text-center transition hover:border-[var(--accent)] hover:bg-[var(--accent-light)]",
        dragCls,
      )}
    >
      <input ref={ref} type="file" accept={ACCEPT} className="hidden" onChange={(e) => handle(e.target.files?.[0])} />
      <div
        className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-xl"
        style={{ background: "var(--accent-light)", color: "var(--accent)" }}
      >
        <FileUp className="h-7 w-7" />
      </div>
      <div className="text-2xl font-semibold sm:text-3xl" style={{ color: "var(--text)" }}>
        Drop invoice here or click to upload
      </div>
      <p className="mt-3 text-base" style={{ color: "var(--text2)" }}>
        PDF, JPG or PNG · Commercial invoices and packing lists
      </p>
    </div>
  );
}
