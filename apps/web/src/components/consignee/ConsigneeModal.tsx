import { useState } from "react";
import type { Consignee } from "@pas/shared-types";
import {
  formatEmailList,
  formatPhoneList,
  isValidEmail,
  parseEmailList,
  parsePhoneList,
} from "@/lib/contact-list";

interface Props {
  consignees: Consignee[];
  activeConsignee: Consignee | null;
  onAdd: (entry: Omit<Consignee, "id">) => void;
  onUpdate: (id: string, updated: Partial<Consignee>) => void;
  onRemove: (id: string) => void;
  onSelect: (c: Consignee) => void;
  onClose: () => void;
}

type FormState = {
  code: string;
  name: string;
  emails: string[];
  phones: string[];
  address: string;
};

function MultiValueEditor({
  label,
  hint,
  values,
  placeholder,
  inputMode,
  onChange,
}: {
  label: string;
  hint?: string;
  values: string[];
  placeholder: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  onChange: (next: string[]) => void;
}) {
  const [draft, setDraft] = useState("");

  const addValue = () => {
    const next = draft.trim();
    if (!next) return;
    if (values.some((v) => v.toLowerCase() === next.toLowerCase())) {
      setDraft("");
      return;
    }
    onChange([...values, next]);
    setDraft("");
  };

  return (
    <div className="mb-3">
      <label className="dd-label">{label}</label>
      {values.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {values.map((value) => (
            <span
              key={value}
              className="inline-flex max-w-full items-center gap-1 rounded-full border px-2.5 py-1 text-[11px]"
              style={{ borderColor: "var(--border)", background: "var(--surface2)", color: "var(--text)" }}
            >
              <span className="truncate">{value}</span>
              <button
                type="button"
                className="border-none bg-transparent text-[12px] leading-none"
                style={{ color: "var(--text2)" }}
                aria-label={`Remove ${value}`}
                onClick={() => onChange(values.filter((entry) => entry !== value))}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <input
          className="dd-input flex-1"
          type="text"
          inputMode={inputMode}
          placeholder={placeholder}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addValue();
            }
          }}
        />
        <button
          type="button"
          className="shrink-0 rounded-[10px] border px-3 text-[12px] font-semibold"
          style={{ borderColor: "var(--border)", background: "var(--surface2)", color: "var(--text)" }}
          onClick={addValue}
        >
          Add
        </button>
      </div>
      {hint && (
        <div className="mt-1 text-[10px]" style={{ color: "var(--text2)" }}>
          {hint}
        </div>
      )}
    </div>
  );
}

export function ConsigneeModal({
  consignees,
  activeConsignee,
  onAdd,
  onUpdate,
  onRemove,
  onSelect,
  onClose,
}: Props) {
  const [view, setView] = useState<"list" | "new" | "edit">("list");
  const [editTarget, setEditTarget] = useState<string | null>(null);
  const empty: FormState = { code: "", name: "", emails: [], phones: [], address: "" };
  const [form, setForm] = useState<FormState>(empty);
  const [err, setErr] = useState("");

  const openNew = () => {
    setForm(empty);
    setErr("");
    setView("new");
  };
  const openEdit = (c: Consignee) => {
    setForm({
      code: c.code || "",
      name: c.name || "",
      emails: parseEmailList(c.email),
      phones: parsePhoneList(c.phone),
      address: c.address || "",
    });
    setEditTarget(c.id);
    setErr("");
    setView("edit");
  };
  const backToList = () => {
    setView("list");
    setErr("");
    setForm(empty);
  };

  const handleSave = () => {
    if (!form.name.trim()) {
      setErr("Name is required.");
      return;
    }
    if (form.emails.some((email) => !isValidEmail(email))) {
      setErr("One or more email addresses are invalid.");
      return;
    }
    const payload = {
      code: form.code.trim(),
      name: form.name.trim(),
      email: formatEmailList(form.emails),
      phone: formatPhoneList(form.phones),
      address: form.address.trim(),
    };
    if (view === "new") {
      if (payload.code && consignees.find((x) => x.code === payload.code)) {
        setErr("A consignee with that code already exists.");
        return;
      }
      onAdd(payload);
      backToList();
    } else if (editTarget) {
      onUpdate(editTarget, {
        name: payload.name,
        email: payload.email,
        phone: payload.phone,
        address: payload.address,
      });
      backToList();
    }
  };

  const title = view === "list" ? "👥 Consignee Directory" : view === "new" ? "➕ New Consignee" : "✏️ Edit Consignee";

  return (
    <div
      className="fixed inset-0 z-[9998] flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.65)" }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="flex max-h-[88vh] w-full max-w-md flex-col rounded-[18px] shadow-2xl"
        style={{ background: "var(--surface)" }}
      >
        <div
          className="flex shrink-0 items-center justify-between border-b px-5 py-4"
          style={{ borderColor: "var(--border)" }}
        >
          <div className="flex items-center gap-2">
            {view !== "list" && (
              <button type="button" onClick={backToList} className="border-none bg-transparent px-1 text-lg" style={{ color: "var(--text2)" }}>
                ←
              </button>
            )}
            <div className="text-[15px] font-bold" style={{ color: "var(--text)" }}>
              {title}
            </div>
          </div>
          <button type="button" onClick={onClose} className="border-none bg-transparent px-1 text-xl" style={{ color: "var(--text2)" }}>
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {view === "list" && (
            <>
              {consignees.length === 0 ? (
                <div className="py-7 text-center" style={{ color: "var(--text2)" }}>
                  <div className="mb-2 text-4xl">👥</div>
                  <div className="text-[13px]">No consignees saved yet</div>
                </div>
              ) : (
                <div className="mb-3">
                  {consignees.map((c) => {
                    const emails = parseEmailList(c.email);
                    const phones = parsePhoneList(c.phone);
                    return (
                      <div
                        key={c.id}
                        className="mb-1.5 flex items-center gap-2 rounded-[10px] border px-3 py-2.5"
                        style={{
                          background: activeConsignee?.id === c.id ? "var(--accent-light)" : "var(--surface2)",
                          borderColor: activeConsignee?.id === c.id ? "var(--accent)" : "var(--border)",
                        }}
                      >
                        <button
                          type="button"
                          className="min-w-0 flex-1 border-none bg-transparent text-left"
                          onClick={() => {
                            onSelect(c);
                            onClose();
                          }}
                        >
                          <div className="flex items-center gap-1.5 text-[13px] font-semibold" style={{ color: "var(--text)" }}>
                            {c.name}
                            {activeConsignee?.id === c.id && (
                              <span className="rounded-full px-1.5 py-px text-[9px] font-bold text-white" style={{ background: "var(--accent)" }}>
                                ACTIVE
                              </span>
                            )}
                          </div>
                          {c.code && (
                            <div className="mt-0.5 font-mono text-[11px]" style={{ color: "var(--accent)" }}>
                              {c.code}
                            </div>
                          )}
                          {emails.map((email) => (
                            <div key={email} className="mt-0.5 truncate text-[11px]" style={{ color: "var(--text2)" }}>
                              ✉ {email}
                            </div>
                          ))}
                          {phones.map((phone) => (
                            <div key={phone} className="mt-0.5 truncate text-[11px]" style={{ color: "var(--text2)" }}>
                              📱 {phone}
                            </div>
                          ))}
                        </button>
                        <div className="flex shrink-0 gap-1">
                          <button type="button" onClick={() => openEdit(c)} className="dd-badge" style={{ background: "var(--accent-light)", color: "var(--accent)" }}>
                            ✏️
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (window.confirm(`Remove ${c.name}?`)) onRemove(c.id);
                            }}
                            className="dd-badge"
                            style={{ background: "var(--red-light)", color: "var(--red)" }}
                          >
                            🗑
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              <button type="button" onClick={openNew} className="w-full rounded-[10px] border-none py-2.5 text-[13px] font-semibold text-white" style={{ background: "var(--accent)" }}>
                + Add New Consignee
              </button>
            </>
          )}

          {(view === "new" || view === "edit") && (
            <>
              {err && <div className="dd-notif-error mb-3">{err}</div>}
              <div className="mb-3">
                <label className="dd-label">Full Name *</label>
                <input className="dd-input" placeholder="e.g. MILEAGE MACK LTD" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} autoFocus />
              </div>
              <div className="mb-3">
                <label className="dd-label">Consignee Code {view === "edit" && <span className="font-normal normal-case">(cannot change)</span>}</label>
                <input className="dd-input" placeholder="e.g. V118954" value={form.code} disabled={view === "edit"} onChange={(e) => setForm((p) => ({ ...p, code: e.target.value }))} />
              </div>
              <MultiValueEditor
                label="Email Addresses"
                hint="Add as many emails as needed — they pre-fill when sending tax advice"
                values={form.emails}
                placeholder="accounts@company.com"
                inputMode="email"
                onChange={(emails) => setForm((p) => ({ ...p, emails }))}
              />
              <MultiValueEditor
                label="WhatsApp / Phone Numbers"
                hint="Add as many numbers as needed — each can receive WhatsApp"
                values={form.phones}
                placeholder="e.g. 868-555-1234"
                inputMode="tel"
                onChange={(phones) => setForm((p) => ({ ...p, phones }))}
              />
              <div className="mb-4">
                <label className="dd-label">Address</label>
                <textarea className="dd-input h-20 resize-y" placeholder={"123 Main Street\nPort of Spain"} value={form.address} onChange={(e) => setForm((p) => ({ ...p, address: e.target.value }))} />
              </div>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={backToList} className="rounded-[10px] border px-4 py-2 text-[13px]" style={{ borderColor: "var(--border)", color: "var(--text2)" }}>
                  Cancel
                </button>
                <button type="button" onClick={handleSave} className="rounded-[10px] border-none px-4 py-2 text-[13px] font-semibold text-white" style={{ background: "var(--accent)" }}>
                  {view === "new" ? "Add Consignee" : "Save Changes"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
