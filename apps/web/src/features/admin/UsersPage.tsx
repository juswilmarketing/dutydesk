import { useCallback, useEffect, useState } from "react";
import type { TeamUser, UserRole } from "@pas/shared-types";
import { api, ApiError } from "@/lib/api-client";
import { useAuthStore } from "@/stores/auth-store";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader, PageLayout } from "@/components/layout/PageHeader";

type FormMode = "create" | "edit" | null;

const emptyForm = {
  username: "",
  name: "",
  password: "",
  role: "clerk" as UserRole,
};

export function UsersPage() {
  const currentUser = useAuthStore((s) => s.user);
  const [users, setUsers] = useState<TeamUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formMode, setFormMode] = useState<FormMode>(null);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { users: list } = await api.getUsers();
      setUsers(list);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load users");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const openCreate = () => {
    setFormMode("create");
    setEditId(null);
    setForm(emptyForm);
    setError(null);
  };

  const openEdit = (user: TeamUser) => {
    setFormMode("edit");
    setEditId(user.id);
    setForm({ username: user.username, name: user.name, password: "", role: user.role });
    setError(null);
  };

  const closeForm = () => {
    setFormMode(null);
    setEditId(null);
    setForm(emptyForm);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      if (formMode === "create") {
        await api.createUser({
          username: form.username.trim(),
          password: form.password,
          name: form.name.trim(),
          role: form.role,
        });
      } else if (formMode === "edit" && editId != null) {
        await api.updateUser(editId, {
          name: form.name.trim(),
          role: form.role,
          ...(form.password ? { password: form.password } : {}),
        });
      }
      closeForm();
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (user: TeamUser) => {
    if (!window.confirm(`Remove user "${user.name}" (${user.username})?`)) return;
    setError(null);
    try {
      await api.deleteUser(user.id);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Delete failed");
    }
  };

  return (
    <PageLayout>
      <PageHeader
        icon="👥"
        title="Team Users"
        description="Manage who can sign in to DutyDesk — display names appear on tax advice emails"
        actions={
          <Button className="text-xs" onClick={openCreate}>
            + Add user
          </Button>
        }
      />

      {error && (
        <div
          className="mb-4 rounded-lg border px-3 py-2.5 text-xs"
          style={{ borderColor: "var(--red)", background: "var(--red-light)", color: "var(--red)" }}
        >
          {error}
        </div>
      )}

      {formMode && (
        <Card className="dd-card mb-4 overflow-hidden border-none shadow-md">
          <div className="border-b px-4 py-3" style={{ borderColor: "var(--border)" }}>
            <div className="text-sm font-semibold">{formMode === "create" ? "Add team member" : "Edit user"}</div>
            <div className="text-[11px]" style={{ color: "var(--text2)" }}>
              {formMode === "create"
                ? "They will sign in with username and password"
                : "Leave password blank to keep the current password"}
            </div>
          </div>
          <div className="grid gap-3 p-4 sm:grid-cols-2">
            <div>
              <label className="dd-label">Username</label>
              <input
                className="dd-input"
                value={form.username}
                disabled={formMode === "edit"}
                placeholder="e.g. jsmith"
                onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
              />
            </div>
            <div>
              <label className="dd-label">Display name</label>
              <input
                className="dd-input"
                value={form.name}
                placeholder="e.g. John Smith"
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
              <div className="mt-1 text-[10px]" style={{ color: "var(--text2)" }}>
                Used in email signatures
              </div>
            </div>
            <div>
              <label className="dd-label">{formMode === "create" ? "Password" : "New password (optional)"}</label>
              <input
                className="dd-input"
                type="password"
                value={form.password}
                placeholder={formMode === "create" ? "Min. 8 characters" : "Leave blank to keep current"}
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
              />
            </div>
            <div>
              <label className="dd-label">Role</label>
              <select
                className="dd-input"
                value={form.role}
                onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as UserRole }))}
              >
                <option value="clerk">Clerk — standard access</option>
                <option value="admin">Admin — includes user management</option>
              </select>
            </div>
          </div>
          <div className="flex justify-end gap-2 border-t px-4 py-3" style={{ borderColor: "var(--border)" }}>
            <Button variant="ghost" className="text-xs" onClick={closeForm}>
              Cancel
            </Button>
            <Button className="text-xs" disabled={saving} onClick={save}>
              {saving ? "Saving…" : formMode === "create" ? "Create user" : "Save changes"}
            </Button>
          </div>
        </Card>
      )}

      <Card className="dd-card overflow-hidden border-none shadow-md">
        {loading ? (
          <div className="px-4 py-8 text-center text-sm" style={{ color: "var(--text2)" }}>
            Loading users…
          </div>
        ) : users.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm" style={{ color: "var(--text2)" }}>
            No users yet — click Add user to create the first account.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table w-full text-xs">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Username</th>
                  <th>Role</th>
                  <th>Added</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => {
                  const isSelf = user.id === currentUser?.id;
                  return (
                    <tr key={user.id}>
                      <td className="font-semibold">
                        {user.name}
                        {isSelf && (
                          <span className="ml-2 text-[10px] font-normal" style={{ color: "var(--text2)" }}>
                            (you)
                          </span>
                        )}
                      </td>
                      <td className="font-mono">{user.username}</td>
                      <td>
                        <Badge tone={user.role === "admin" ? "blue" : "default"}>{user.role}</Badge>
                      </td>
                      <td style={{ color: "var(--text2)" }}>
                        {new Date(user.createdAt).toLocaleDateString("en-TT")}
                      </td>
                      <td className="text-right">
                        <button
                          type="button"
                          className="mr-2 rounded border px-2 py-1 text-[10px] font-semibold"
                          style={{ borderColor: "var(--border)", color: "var(--accent)" }}
                          onClick={() => openEdit(user)}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          disabled={isSelf}
                          className="rounded border px-2 py-1 text-[10px] font-semibold disabled:opacity-40"
                          style={{ borderColor: "var(--border)", color: "var(--red)" }}
                          onClick={() => remove(user)}
                          title={isSelf ? "Cannot delete your own account" : "Remove user"}
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </PageLayout>
  );
}
