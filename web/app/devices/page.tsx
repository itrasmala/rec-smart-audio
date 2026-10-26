"use client";
import { Bluetooth, Copy, Cpu, Info, KeyRound, Pencil, Plus, RefreshCw, ShieldOff, Trash2 } from "lucide-react";
import { useState } from "react";
import { describeResult } from "@/components/control-deck";
import { Badge, Button, cx, Dot, Empty, Field, Input, Loading, Modal, PageHeader, Select, useFeedback, VolumeSlider } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { sendCommand, useDevices } from "@/lib/devices";
import { fmtBytes, relative } from "@/lib/format";
import { L } from "@/lib/labels";
import { usePrefs } from "@/lib/prefs";
import type { Device, OutputType } from "@/lib/types";

const OUTPUTS: OutputType[] = ["AUX", "USB", "BLUETOOTH", "HDMI", "OTHER", "UNKNOWN"];

function TokenModal({ token, name, onClose }: { token: string; name: string; onClose: () => void }) {
  const { t } = usePrefs();
  const { toast } = useFeedback();
  const [os, setOs] = useState<"windows" | "linux">("windows");
  const origin = typeof window !== "undefined" ? window.location.origin : "https://audio.example.com";
  const copy = (s: string) =>
    navigator.clipboard
      ?.writeText(s)
      .then(() => toast(t("تم النسخ", "Copied")))
      .catch(() => toast(t("انسخ الأمر يدويًا", "Copy the command manually"), "neutral"));
  const commands = {
    windows: `powershell -NoProfile -ExecutionPolicy Bypass -Command "& ([scriptblock]::Create((irm '${origin}/agent/install.ps1'))) -Server '${origin}' -Token '${token}'"`,
    linux: `curl -fsSL ${origin}/agent/install.sh | bash -s -- --server ${origin} --token ${token}`,
  };
  const steps =
    os === "windows"
      ? [
          t("على جهاز التشغيل الموصول بالسماعات: افتح قائمة ابدأ واكتب PowerShell ثم افتحه.", "On the playback machine wired to the speakers: open Start, type PowerShell and open it."),
          t("الصق الأمر واضغط Enter، ثم وافق على نافذة صلاحيات المسؤول.", "Paste the command, press Enter, and accept the administrator prompt."),
          t("انتظر حتى تظهر رسالة اكتمال التثبيت (دقيقتان تقريبًا). سيظهر الجهاز هنا «متصل».", "Wait for the “installation complete” message (about two minutes). The device will show as Online here."),
        ]
      : [
          t("على جهاز التشغيل: افتح الطرفية (Terminal) بحساب المستخدم العادي (ليس root).", "On the playback machine: open a terminal as a normal user (not root)."),
          t("الصق الأمر واضغط Enter. قد يُطلب منك كلمة مرور sudo مرة واحدة.", "Paste the command and press Enter. You may be asked for your sudo password once."),
          t("بعد الاكتمال سيظهر الجهاز هنا «متصل».", "When it finishes, the device shows as Online here."),
        ];
  return (
    <Modal open wide onClose={onClose} title={t(`تثبيت جهاز التشغيل: ${name}`, `Install playback device: ${name}`)} footer={<Button variant="primary" onClick={onClose}>{t("تم", "Done")}</Button>}>
      <div className="space-y-5 text-sm">
        <div className="flex w-fit rounded-lg border border-line p-0.5">
          {(["windows", "linux"] as const).map((o) => (
            <button key={o} onClick={() => setOs(o)} className={cx("rounded-md px-4 py-1.5", os === o ? "bg-petrol-soft font-medium text-petrol" : "text-ink-2")}>
              {o === "windows" ? "Windows" : "Linux"}
            </button>
          ))}
        </div>
        <ol className="space-y-2">
          {steps.map((s, i) => (
            <li key={i} className="flex gap-3">
              <span className="tnum flex size-6 shrink-0 items-center justify-center rounded-full bg-petrol-soft text-xs font-semibold text-petrol">{i + 1}</span>
              <span className="pt-0.5">{s}</span>
            </li>
          ))}
        </ol>
        <div className="rounded-lg bg-side p-3">
          <code dir="ltr" className="block max-h-32 overflow-y-auto break-all text-[12.5px] leading-relaxed text-side-ink">
            {commands[os]}
          </code>
          <Button size="sm" variant="sodium" className="mt-3" icon={<Copy className="size-4" />} onClick={() => copy(commands[os])}>
            {t("نسخ الأمر", "Copy command")}
          </Button>
        </div>
        <p className="rounded-lg bg-sodium-soft px-3 py-2 text-sodium-ink">
          {t("الأمر يحتوي رمز هذا الجهاز ولن يظهر مرة أخرى. لا تشاركه. إن فقدته اضغط «رمز جديد» على بطاقة الجهاز.", "The command contains this device's token and won't be shown again. Don't share it. If you lose it, use “New token” on the device card.")}
        </p>
        <details className="text-ink-3">
          <summary className="cursor-pointer">{t("الرمز وحده (للتثبيت اليدوي)", "Token only (manual install)")}</summary>
          <div className="mt-2 flex items-center gap-2">
            <code dir="ltr" className="flex-1 overflow-x-auto whitespace-nowrap rounded-lg border border-line bg-surface-2 px-3 py-2 text-[13px] text-ink">
              {token}
            </code>
            <Button size="sm" icon={<Copy className="size-4" />} onClick={() => copy(token)}>
              {t("نسخ", "Copy")}
            </Button>
          </div>
        </details>
      </div>
    </Modal>
  );
}

function AddModal({ onClose, onCreated }: { onClose: () => void; onCreated: (token: string, name: string) => void }) {
  const { t, lang } = usePrefs();
  const { toast } = useFeedback();
  const [f, setF] = useState({ name: "", location: "", outputType: "AUX" as OutputType });
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      const r = await api.post<{ token: string; device: Device }>("/api/devices", f);
      onCreated(r.token, r.device.name);
    } catch (e) {
      toast((e as Error).message, "fault");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open onClose={onClose} title={t("إضافة جهاز تشغيل", "Add playback device")} footer={<><Button onClick={onClose}>{t("إلغاء", "Cancel")}</Button><Button variant="primary" loading={busy} disabled={!f.name.trim()} onClick={save}>{t("إضافة وإنشاء الرمز", "Add and create token")}</Button></>}>
      <div className="space-y-4">
        <Field label={t("اسم الجهاز", "Device name")}>{(id) => <Input id={id} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder={t("مثال: مشغل الداتا سنتر", "e.g. Data-center player")} autoFocus />}</Field>
        <Field label={t("الموقع / المنطقة", "Location / zone")}>{(id) => <Input id={id} value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} placeholder={t("مثال: ممرات الدور الأول", "e.g. First-floor corridors")} />}</Field>
        <Field label={t("نوع مخرج الصوت", "Output type")}>
          {(id) => (
            <Select id={id} value={f.outputType} onChange={(e) => setF({ ...f, outputType: e.target.value as OutputType })}>
              {OUTPUTS.map((o) => <option key={o} value={o}>{L.output(o, lang)}</option>)}
            </Select>
          )}
        </Field>
      </div>
    </Modal>
  );
}

function EditModal({ device, onClose, onSaved }: { device: Device; onClose: () => void; onSaved: () => void }) {
  const { t, lang } = usePrefs();
  const { toast } = useFeedback();
  const outputs = device.lastStatus?.outputs ?? device.availableOutputs ?? [];
  const [f, setF] = useState({
    name: device.name,
    location: device.location ?? "",
    outputType: device.outputType,
    outputDeviceName: device.outputDeviceName ?? "",
    bluetoothMac: device.bluetoothMac ?? "",
    volume: device.volume,
    maxVolume: device.maxVolume,
  });
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      await api.patch(`/api/devices/${device.id}`, {
        ...f,
        location: f.location || null,
        outputDeviceName: f.outputDeviceName || null,
        bluetoothMac: f.bluetoothMac.trim() || null,
      });
      toast(t("تم حفظ إعدادات الجهاز وإرسالها إليه", "Saved and sent to the device"));
      onSaved();
    } catch (e) {
      toast((e as Error).message, "fault");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open wide onClose={onClose} title={t("إعدادات الجهاز", "Device settings")} footer={<><Button onClick={onClose}>{t("إلغاء", "Cancel")}</Button><Button variant="primary" loading={busy} onClick={save}>{t("حفظ", "Save")}</Button></>}>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label={t("اسم الجهاز", "Name")}>{(id) => <Input id={id} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}</Field>
        <Field label={t("الموقع", "Location")}>{(id) => <Input id={id} value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} />}</Field>
        <Field label={t("نوع المخرج", "Output type")}>
          {(id) => (
            <Select id={id} value={f.outputType} onChange={(e) => setF({ ...f, outputType: e.target.value as OutputType })}>
              {OUTPUTS.map((o) => <option key={o} value={o}>{L.output(o, lang)}</option>)}
            </Select>
          )}
        </Field>
        <Field label={t("مخرج الصوت على الجهاز", "Audio output on the device")} hint={outputs.length ? t("القائمة كما يراها نظام تشغيل الجهاز", "As reported by the device OS") : t("تظهر القائمة بعد اتصال الجهاز", "Appears once the device connects")}>
          {(id) => (
            <Select id={id} value={f.outputDeviceName} onChange={(e) => setF({ ...f, outputDeviceName: e.target.value })}>
              <option value="">{t("المخرج الافتراضي للنظام", "System default output")}</option>
              {outputs.map((o) => <option key={o} value={o}>{o}</option>)}
              {f.outputDeviceName && !outputs.includes(f.outputDeviceName) && <option value={f.outputDeviceName}>{f.outputDeviceName}</option>}
            </Select>
          )}
        </Field>
        {f.outputType === "BLUETOOTH" && (
          <Field label={t("عنوان MAC للسماعة (لإعادة الاتصال التلقائي)", "Speaker MAC (for auto-reconnect)")} hint="AA:BB:CC:DD:EE:FF" className="md:col-span-2">
            {(id) => <Input id={id} dir="ltr" value={f.bluetoothMac} onChange={(e) => setF({ ...f, bluetoothMac: e.target.value })} placeholder="AA:BB:CC:DD:EE:FF" />}
          </Field>
        )}
        <div>
          <p className="mb-2 text-[13px] font-medium text-ink-2">{t("مستوى الصوت الافتراضي", "Default volume")}</p>
          <VolumeSlider label={t("الصوت", "Volume")} value={f.volume} max={f.maxVolume} onChange={(v) => setF({ ...f, volume: v })} />
        </div>
        <div>
          <p className="mb-2 text-[13px] font-medium text-ink-2">{t("الحد الأقصى المسموح لهذا الجهاز", "Maximum allowed for this device")}</p>
          <VolumeSlider label={t("الحد الأقصى", "Maximum")} value={f.maxVolume} onChange={(v) => setF({ ...f, maxVolume: v, volume: Math.min(f.volume, v) })} />
        </div>
      </div>
    </Modal>
  );
}

function Row({ k, v, tone }: { k: string; v: React.ReactNode; tone?: "fault" }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5 text-sm">
      <dt className="shrink-0 text-ink-3">{k}</dt>
      <dd className={cx("min-w-0 truncate text-end", tone === "fault" && "text-fault")}>{v}</dd>
    </div>
  );
}

function DeviceCard({ d, onEdit, onToken, reload }: { d: Device; onEdit: () => void; onToken: (tok: string) => void; reload: () => void }) {
  const { t, lang } = usePrefs();
  const { can } = useAuth();
  const { toast, confirm } = useFeedback();
  const isAdmin = can("SUPER_ADMIN");
  const st = d.lastStatus;
  const revoked = !!d.revokedAt;

  async function cmd(type: string) {
    try {
      const [m, tone] = describeResult(await sendCommand(d.id, type), t);
      toast(m, tone);
    } catch (e) {
      toast((e as Error).message, "fault");
    }
  }
  async function rotate() {
    if (!(await confirm({ title: t("توليد رمز جديد؟", "Generate a new token?"), body: t("سيتوقف الرمز الحالي فورًا وينقطع الجهاز حتى تضع الرمز الجديد في إعداداته.", "The current token stops working immediately; the device disconnects until you configure the new token.") }))) return;
    const r = await api.post<{ token: string }>(`/api/devices/${d.id}/rotate-token`);
    onToken(r.token);
    reload();
  }
  async function revoke() {
    if (!(await confirm({ title: t("إلغاء صلاحية الجهاز؟", "Revoke this device?"), body: t("يُقطع اتصاله فورًا ولن يقبل الخادم اتصاله مرة أخرى. سيستمر في تشغيل الأذان المخزن محليًا إلى أن يُوقف يدويًا.", "It is disconnected immediately and can no longer connect. It keeps playing locally stored adhan until stopped on site."), danger: true, confirmLabel: t("إلغاء الصلاحية", "Revoke") }))) return;
    await api.post(`/api/devices/${d.id}/revoke`);
    toast(t("أُلغيت صلاحية الجهاز", "Device revoked"));
    reload();
  }
  async function remove() {
    if (!(await confirm({ title: t("حذف الجهاز نهائيًا؟", "Delete device?"), body: t("يُحذف الجهاز وسجلات تشغيله.", "The device and its playback logs are deleted."), danger: true, confirmLabel: t("حذف", "Delete") }))) return;
    await api.del(`/api/devices/${d.id}`);
    reload();
  }

  return (
    <article className={cx("flex flex-col rounded-[10px] border bg-surface", revoked ? "border-line opacity-70" : d.isOnline ? "border-line" : "border-fault/40")}>
      <header className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
        <div className="min-w-0">
          <h3 className="truncate font-semibold">{d.name}</h3>
          <p className="truncate text-[13px] text-ink-3">{d.location || t("بدون موقع", "No location")}</p>
        </div>
        {revoked ? (
          <Badge tone="fault">{t("ملغى", "Revoked")}</Badge>
        ) : (
          <Badge tone={d.isOnline ? "ok" : "fault"}>
            <Dot tone={d.isOnline ? "ok" : "fault"} />
            {d.isOnline ? t("متصل", "Online") : t("غير متصل", "Offline")}
          </Badge>
        )}
      </header>
      <dl className="flex-1 divide-y divide-line/60 px-5 py-2">
        <Row k={t("نظام التشغيل", "OS")} v={<span dir="ltr">{d.os ?? "—"}</span>} />
        <Row k={t("اسم الجهاز في الشبكة", "Hostname")} v={<span dir="ltr">{d.hostname ?? "—"}</span>} />
        <Row k={t("نوع مخرج الصوت", "Output type")} v={L.output(d.outputType, lang)} />
        <Row k={t("السماعة المتصلة", "Connected speaker")} v={st?.output?.name ?? d.speakerName ?? "—"} tone={st?.output && !st.output.ok ? "fault" : undefined} />
        {d.outputType === "BLUETOOTH" && (
          <Row
            k={t("البلوتوث", "Bluetooth")}
            v={st?.bluetooth?.mac ? (st.bluetooth.connected ? t("متصل", "Connected") : t("منقطع", "Disconnected")) : t("لم يُحدد MAC", "No MAC set")}
            tone={st?.bluetooth?.connected === false ? "fault" : undefined}
          />
        )}
        <Row k={t("مستوى الصوت", "Volume")} v={<span className="tnum"><bdi dir="ltr">{st?.volume ?? d.volume}%</bdi> <span className="text-ink-3">— {t("الحد", "max")} <bdi dir="ltr">{d.maxVolume}%</bdi></span></span>} />
        <Row k={t("آخر اتصال", "Last seen")} v={relative(d.lastSeenAt, lang)} />
        <Row k={t("الملفات المخزنة محليًا", "Cached files")} v={st ? <span className="tnum">{st.cache.files} — <bdi dir="ltr">{fmtBytes(st.cache.bytes)}</bdi>{st.cache.missingEssential ? <span className="text-fault"> — {t("ناقص", "missing")} {st.cache.missingEssential}</span> : null}</span> : "—"} />
        <Row k={t("خطة الأذان المخزنة حتى", "Adhan plan stored until")} v={<span className="tnum">{st?.planUntil ?? "—"}</span>} />
        {st && Math.abs(st.serverClockSkewSec) > 30 && <Row k={t("ساعة الجهاز", "Device clock")} v={t(`فرق ${Math.round(st.serverClockSkewSec)} ث`, `${Math.round(st.serverClockSkewSec)}s off`)} tone="fault" />}
        <Row k={t("آخر خطأ", "Last error")} v={d.lastError ?? t("لا يوجد", "None")} tone={d.lastError ? "fault" : undefined} />
        <Row k={t("الإصدار", "Version")} v={<span dir="ltr">{d.agentVersion ?? "—"} · {d.tokenPrefix ? `rec_${d.tokenPrefix}…` : ""}</span>} />
      </dl>
      {isAdmin && (
        <footer className="flex flex-wrap gap-1 border-t border-line px-3 py-2.5">
          {!revoked && <Button size="sm" variant="ghost" icon={<Pencil className="size-3.5" />} onClick={onEdit}>{t("الإعدادات", "Settings")}</Button>}
          {!revoked && d.isOnline && <Button size="sm" variant="ghost" icon={<RefreshCw className="size-3.5" />} onClick={() => void cmd("sync")}>{t("مزامنة", "Sync")}</Button>}
          {!revoked && d.isOnline && d.outputType === "BLUETOOTH" && <Button size="sm" variant="ghost" icon={<Bluetooth className="size-3.5" />} onClick={() => void cmd("bt_reconnect")}>{t("إعادة اتصال البلوتوث", "Reconnect BT")}</Button>}
          <Button size="sm" variant="ghost" icon={<KeyRound className="size-3.5" />} onClick={() => void rotate()}>{revoked ? t("إعادة التفعيل برمز جديد", "Re-enable with new token") : t("رمز جديد", "New token")}</Button>
          {!revoked && <Button size="sm" variant="ghost" icon={<ShieldOff className="size-3.5" />} className="text-fault" onClick={() => void revoke()}>{t("إلغاء الصلاحية", "Revoke")}</Button>}
          {revoked && <Button size="sm" variant="ghost" icon={<Trash2 className="size-3.5" />} className="text-fault" onClick={() => void remove()}>{t("حذف", "Delete")}</Button>}
        </footer>
      )}
    </article>
  );
}

export default function DevicesPage() {
  const { t } = usePrefs();
  const { can } = useAuth();
  const { devices, loading, reload } = useDevices();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Device | null>(null);
  const [token, setToken] = useState<{ token: string; name: string } | null>(null);

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("الأجهزة والسماعات", "Devices & speakers")}
        description={t("أجهزة التشغيل المحلية في المؤسسة. كل جهاز يتصل بالخادم اتصالًا صادرًا آمنًا ويشغّل الصوت على السماعات الموصولة به.", "Local playback machines. Each one opens a secure outbound connection to the server and plays audio on the speakers attached to it.")}
        actions={can("SUPER_ADMIN") ? <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setAdding(true)}>{t("إضافة جهاز", "Add device")}</Button> : undefined}
      />
      <div className="flex gap-3 rounded-[10px] border border-petrol/25 bg-petrol-soft px-5 py-4 text-sm text-ink-2">
        <Info className="mt-0.5 size-4 shrink-0 text-petrol" />
        <p>
          {t(
            "سماعات البلوتوث العادية لا يمكن إدارتها مباشرة من موقع الويب. يتم إقران السماعة مرة واحدة من إعدادات نظام التشغيل على جهاز التشغيل نفسه (Windows أو Linux)، ثم يختارها النظام هنا كمخرج صوت ويعيد الاتصال بها تلقائيًا عند الانقطاع قدر ما يسمح به نظام التشغيل.",
            "Ordinary Bluetooth speakers cannot be managed directly from a website. Pair the speaker once in the operating system of the playback machine (Windows or Linux); it then appears here as an audio output and the agent reconnects to it automatically when the link drops, as far as the OS allows.",
          )}
        </p>
      </div>
      {loading && !devices.length ? (
        <Loading />
      ) : !devices.length ? (
        <div className="rounded-[10px] border border-line bg-surface">
          <Empty icon={<Cpu className="size-8" />} title={t("لا توجد أجهزة بعد", "No devices yet")} body={t("أضف الجهاز الموجود في الداتا سنتر، ثم ثبّت برنامج التشغيل عليه بالرمز الذي سيظهر لك.", "Add the data-center machine, then install the agent on it with the token you'll be shown.")} />
        </div>
      ) : (
        <div className="grid gap-5 md:grid-cols-2 2xl:grid-cols-3">
          {devices.map((d) => (
            <DeviceCard key={d.id} d={d} onEdit={() => setEditing(d)} onToken={(tok) => setToken({ token: tok, name: d.name })} reload={() => void reload()} />
          ))}
        </div>
      )}
      {adding && <AddModal onClose={() => setAdding(false)} onCreated={(tok, name) => { setAdding(false); setToken({ token: tok, name }); void reload(); }} />}
      {editing && <EditModal device={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void reload(); }} />}
      {token && <TokenModal token={token.token} name={token.name} onClose={() => setToken(null)} />}
    </div>
  );
}
