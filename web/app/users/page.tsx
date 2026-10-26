"use client";
import { KeyRound, Lock, Pencil, Plus, Trash2, UserX } from "lucide-react";
import { useState } from "react";
import { Badge, Button, Empty, ErrorNote, Field, Input, Loading, Modal, PageHeader, Panel, Select, Toggle, useFeedback } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { relative } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { L } from "@/lib/labels";
import { usePrefs } from "@/lib/prefs";
import type { Role, User } from "@/lib/types";

const ROLES: Role[] = ["SUPER_ADMIN", "AUDIO_MANAGER", "VIEWER"];
const ROLE_SCOPE: Record<Role, [string, string]> = {
  SUPER_ADMIN: ["تحكم كامل: المستخدمون، الأذان، الأجهزة، كل الصوتيات", "Full control: users, adhan, devices, all audio"],
  AUDIO_MANAGER: ["تشغيل ورفع الملفات، الجداول، الصوت ضمن الحد المسموح", "Play & upload, schedules, volume within the limit"],
  VIEWER: ["مشاهدة الحالة وجدول الصلاة وسجل التشغيل فقط", "View status, prayer times and the activity log only"],
};

function UserModal({ user, onClose, onSaved }: { user?: User; onClose: () => void; onSaved: () => void }) {
  const { t, lang } = usePrefs();
  const { toast } = useFeedback();
  const [f, setF] = useState({ username: user?.username ?? "", displayName: user?.displayName ?? "", role: (user?.role ?? "AUDIO_MANAGER") as Role, password: "", isActive: user?.isActive ?? true });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function save() {
    setBusy(true);
    setErr(null);
    try {
      if (user) await api.patch(`/api/users/${user.id}`, { displayName: f.displayName, role: f.role, isActive: f.isActive });
      else await api.post("/api/users", { username: f.username, displayName: f.displayName, role: f.role, password: f.password, mustChangePassword: true });
      toast(user ? t("تم تحديث المستخدم", "User updated") : t("تم إنشاء المستخدم — سيُطلب منه تغيير كلمة المرور", "User created — they'll be asked to change the password"));
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open onClose={onClose} title={user ? t("تعديل المستخدم", "Edit user") : t("مستخدم جديد", "New user")} footer={<><Button onClick={onClose}>{t("إلغاء", "Cancel")}</Button><Button variant="primary" loading={busy} onClick={save}>{user ? t("حفظ", "Save") : t("إنشاء المستخدم", "Create user")}</Button></>}>
      <div className="space-y-4">
        <Field label={t("الاسم الظاهر", "Display name")}>{(id) => <Input id={id} value={f.displayName} onChange={(e) => setF({ ...f, displayName: e.target.value })} />}</Field>
        {!user && (
          <>
            <Field label={t("اسم المستخدم (لاتيني)", "Username")} hint={t("3–40 حرفًا: a-z و 0-9 و . _ -", "3–40 chars: a-z, 0-9, . _ -")}>{(id) => <Input id={id} dir="ltr" autoComplete="off" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} />}</Field>
            <Field label={t("كلمة مرور مؤقتة", "Temporary password")} hint={t("10 أحرف على الأقل، حروف وأرقام", "At least 10 chars, letters and digits")}>{(id) => <Input id={id} dir="ltr" type="password" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />}</Field>
          </>
        )}
        <Field label={t("الصلاحية", "Role")} hint={ROLE_SCOPE[f.role][lang === "ar" ? 0 : 1]}>
          {(id) => (
            <Select id={id} value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as Role })}>
              {ROLES.map((r) => <option key={r} value={r}>{L.role(r, lang)}</option>)}
            </Select>
          )}
        </Field>
        {user && (
          <label className="flex items-center justify-between">
            <span className="text-sm">{t("الحساب نشط", "Account active")}</span>
            <Toggle checked={f.isActive} onChange={(v) => setF({ ...f, isActive: v })} />
          </label>
        )}
        {err && <p className="rounded-lg bg-fault-soft px-3 py-2 text-sm text-fault">{err}</p>}
      </div>
    </Modal>
  );
}

function ResetModal({ user, onClose }: { user: User; onClose: () => void }) {
  const { t } = usePrefs();
  const { toast } = useFeedback();
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      await api.post(`/api/users/${user.id}/reset-password`, { password: pw });
      toast(t("تم تعيين كلمة مرور مؤقتة وإنهاء جلسات المستخدم", "Temporary password set; user's sessions ended"));
      onClose();
    } catch (e) {
      toast((e as Error).message, "fault");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open onClose={onClose} title={t(`إعادة تعيين كلمة مرور ${user.displayName}`, `Reset password for ${user.displayName}`)} footer={<><Button onClick={onClose}>{t("إلغاء", "Cancel")}</Button><Button variant="primary" loading={busy} disabled={pw.length < 10} onClick={save}>{t("تعيين", "Set password")}</Button></>}>
      <Field label={t("كلمة المرور المؤقتة", "Temporary password")} hint={t("سيُطلب من المستخدم تغييرها عند الدخول", "The user must change it at next sign-in")}>{(id) => <Input id={id} dir="ltr" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />}</Field>
    </Modal>
  );
}

export default function UsersPage() {
  const { t, lang } = usePrefs();
  const { user: me } = useAuth();
  const { toast, confirm } = useFeedback();
  const { data, error, loading, reload } = useApi<{ users: User[] }>("/api/users");
  const [modal, setModal] = useState<{ user?: User } | null>(null);
  const [reset, setReset] = useState<User | null>(null);

  async function unlock(u: User) {
    await api.patch(`/api/users/${u.id}`, { unlock: true });
    toast(t("تم فك القفل", "Unlocked"));
    void reload();
  }
  async function remove(u: User) {
    if (!(await confirm({ title: t("حذف المستخدم؟", "Delete user?"), body: `${u.displayName} (${u.username})`, danger: true, confirmLabel: t("حذف", "Delete") }))) return;
    try {
      await api.del(`/api/users/${u.id}`);
      void reload();
    } catch (e) {
      toast((e as Error).message, "fault");
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title={t("المستخدمون والصلاحيات", "Users & roles")} actions={<Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setModal({})}>{t("مستخدم جديد", "New user")}</Button>} />
      <div className="grid gap-3 md:grid-cols-3">
        {ROLES.map((r) => (
          <div key={r} className="rounded-[10px] border border-line bg-surface px-4 py-3">
            <p className="text-sm font-semibold">{L.role(r, lang)}</p>
            <p className="text-[13px] text-ink-3">{ROLE_SCOPE[r][lang === "ar" ? 0 : 1]}</p>
          </div>
        ))}
      </div>
      <Panel bodyClassName="p-0">
        {loading && !data ? <Loading /> : error ? <div className="p-5"><ErrorNote error={error} /></div> : !data?.users.length ? <Empty title={t("لا يوجد مستخدمون", "No users")} /> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-line text-[12.5px] text-ink-3">
                  <th className="px-5 py-2.5 text-start font-medium">{t("المستخدم", "User")}</th>
                  <th className="px-3 py-2.5 text-start font-medium">{t("الصلاحية", "Role")}</th>
                  <th className="px-3 py-2.5 text-start font-medium">{t("الحالة", "Status")}</th>
                  <th className="px-3 py-2.5 text-start font-medium">{t("آخر دخول", "Last sign-in")}</th>
                  <th className="px-5 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.users.map((u) => {
                  const locked = u.lockedUntil && new Date(u.lockedUntil).getTime() > Date.now();
                  return (
                    <tr key={u.id}>
                      <td className="px-5 py-3">
                        <p className="font-medium">{u.displayName} {u.id === me?.id && <span className="text-xs font-normal text-ink-3">({t("أنت", "you")})</span>}</p>
                        <p className="text-xs text-ink-3" dir="ltr">{u.username}</p>
                      </td>
                      <td className="px-3 py-3"><Badge tone={u.role === "SUPER_ADMIN" ? "petrol" : "neutral"}>{L.role(u.role, lang)}</Badge></td>
                      <td className="px-3 py-3">
                        {!u.isActive ? <Badge tone="fault"><UserX className="size-3" />{t("معطّل", "Disabled")}</Badge> : locked ? <Badge tone="sodium"><Lock className="size-3" />{t("مقفل مؤقتًا", "Locked")}</Badge> : <Badge tone="ok">{t("نشط", "Active")}</Badge>}
                        {u.mustChangePassword && <p className="mt-1 text-xs text-ink-3">{t("بانتظار تغيير كلمة المرور", "Must change password")}</p>}
                      </td>
                      <td className="px-3 py-3 text-ink-2">{relative(u.lastLoginAt ?? null, lang)}</td>
                      <td className="px-5 py-3">
                        <div className="flex justify-end gap-1">
                          {locked && <Button size="sm" variant="ghost" onClick={() => void unlock(u)}>{t("فك القفل", "Unlock")}</Button>}
                          <button onClick={() => setModal({ user: u })} className="rounded-lg p-2 text-ink-3 hover:bg-surface-2 hover:text-ink" aria-label={t("تعديل", "Edit")}><Pencil className="size-4" /></button>
                          <button onClick={() => setReset(u)} className="rounded-lg p-2 text-ink-3 hover:bg-surface-2 hover:text-ink" aria-label={t("كلمة مرور جديدة", "Reset password")} title={t("كلمة مرور جديدة", "Reset password")}><KeyRound className="size-4" /></button>
                          {u.id !== me?.id && <button onClick={() => void remove(u)} className="rounded-lg p-2 text-ink-3 hover:bg-fault-soft hover:text-fault" aria-label={t("حذف", "Delete")}><Trash2 className="size-4" /></button>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      {modal && <UserModal user={modal.user} onClose={() => setModal(null)} onSaved={() => { setModal(null); void reload(); }} />}
      {reset && <ResetModal user={reset} onClose={() => setReset(null)} />}
    </div>
  );
}
