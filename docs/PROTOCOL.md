# بروتوكول الاتصال: الخادم ↔ جهاز التشغيل

- النقل: WebSocket عبر TLS ‏`wss://<domain>/ws/agent` — **اتصال صادر من الجهاز فقط**.
- المصادقة: ترويسة `Authorization: Bearer rec_<prefix>_<secret>` تُفحص **قبل** ترقية الاتصال (رمز خاطئ/ملغى ⇐ HTTP 401 دون فتح Socket).
- نبض: Ping كل 20 ثانية من الطرفين؛ انقطاع النبض ⇐ إغلاق وإعادة المحاولة بتأخير أُسّي (1 ← 60 ثانية مع عشوائية).
- الرسائل JSON، والخادم يعالج رسائل كل جهاز بالترتيب (طابور تسلسلي).

## من الجهاز إلى الخادم

| النوع | الحقول | متى |
|---|---|---|
| `hello` | `version, os, hostname, outputs[], configRevision` | فور الاتصال |
| `status` | الحالة الكاملة (انظر أدناه) | كل 10 ثوانٍ وعند أي تغيير |
| `ack` | `commandId, ok, error?, result?` | بعد تنفيذ كل أمر |
| `events` | `events[]` (سجل تشغيل) | فور حدوثها، ودفعة واحدة بعد عودة الاتصال |
| `config_applied` | `revision, cache` | بعد حفظ الإعدادات وتنزيل الملفات الأساسية |
| `request_config` | — | عند أمر المزامنة |

### `status`
```json
{
  "type": "status", "state": "playing",
  "current": { "key": "adhan:2026-10-25:DHUHR", "title": "أذان الظهر", "priority": "ADHAN",
               "source": "ADHAN", "positionSec": 42.5, "durationSec": 181 },
  "queue": [{ "key": "sched:…", "title": "إعلان", "priority": "ANNOUNCEMENT" }],
  "volume": 85, "deviceVolume": 60, "quietUntil": null,
  "output": { "name": "Speakers (USB Audio)", "preferred": "Speakers (USB Audio)", "ok": true, "error": null },
  "bluetooth": { "mac": null, "connected": null },
  "internet": true, "serverConnected": true, "serverClockSkewSec": 0.2,
  "configRevision": 17, "planUntil": "2026-12-23", "usingFallbackPrayerTimes": false,
  "cache": { "files": 6, "bytes": 4823011, "missing": 0, "missingEssential": 0 },
  "nextEvents": [{ "key": "adhan:2026-10-25:ASR", "title": "أذان العصر", "at": "2026-10-25T11:52:00Z" }],
  "unsyncedEvents": 0, "uptimeSec": 86400, "lastError": null, "outputs": ["…"]
}
```

### `events[]` — سجل التشغيل
```json
{ "eventKey": "sched:<scheduleId>:2026-10-25T07:00", "source": "SCHEDULE", "priority": "ANNOUNCEMENT",
  "fileId": "…", "title": "رسالة ترحيبية", "prayer": null, "scheduleId": "…", "commandId": null,
  "status": "COMPLETED", "error": null, "offline": true,
  "startedAt": "2026-10-25T04:00:00.120Z", "endedAt": "2026-10-25T04:00:25.300Z" }
```
الخادم يحفظها بـ upsert على `(deviceId, eventKey)` ثم يرد `events_ack {keys}`؛ الجهاز لا يعلّم الحدث "مُزامنًا" إلا إذا لم يتغير بعد إرساله — فلا يضيع تحديث ولا يتكرر سجل.

مفاتيح الأحداث:
| المصدر | المفتاح |
|---|---|
| أذان تلقائي | `adhan:YYYY-MM-DD:PRAYER` |
| جدولة | `sched:<scheduleId>:YYYY-MM-DDTHH:mm` (بالتوقيت المحلي) |
| تشغيل يدوي | `cmd:<commandId>` |
| اختبار | `test:<commandId>` |

## من الخادم إلى الجهاز

| النوع | الوصف |
|---|---|
| `welcome` | `deviceId, name, serverTime` — لقياس فرق الساعة (تحذير إن تجاوز 30 ث) |
| `config` | لقطة كاملة تُحفظ محليًا: `revision, timezone, device{volume,maxVolume,outputDeviceName,bluetoothMac}, policy{…}, prayer{params, configs, overrides, plan[], planUntil}, schedules[], files[]` |
| `command` | `id, command, payload, expiresAt` |
| `events_ack` | `keys[]` |

`prayer.plan` = أوقات الأذان الفعلية (بعد التعديلات) لـ 61 يومًا. بعدها يحسب الجهاز أم القرى محليًا بالخوارزمية نفسها (مطابقة 100% لمدة سنتين في الاختبارات).

### الأوامر
| `command` | `payload` | ملاحظات |
|---|---|---|
| `play` | `fileId, priority (EMERGENCY/ANNOUNCEMENT/GENERAL), volume?, interruptAdhan?, title, sha256, format` | ينزّل الملف إن لم يكن مخزنًا |
| `stop` | `includeAdhan, clearQueue` | `includeAdhan` لمدير النظام فقط |
| `pause` / `resume` | — | لا يمكن إيقاف الأذان مؤقتًا إلا لمدير النظام |
| `volume` | `level` | مقيّد بحد الجهاز وحد الدور |
| `volume_step` | `delta, level` | |
| `test_speakers` | — | نغمة اختبار تُولَّد محليًا |
| `adhan_test` | `prayer` | لا يُحتسب كأذان فعلي |
| `bt_reconnect` | — | |
| `set_output` | `deviceName` | |
| `sync` | — | إعادة طلب الإعدادات ودفع السجلات |

كل أمر يحمل `privileged` (هل المرسل مدير نظام) و`maxVolume`؛ الخادم يتحقق من الصلاحيات أولًا والجهاز يطبّق القيود مرة ثانية. الأمر الذي تنتهي مهلته (`expiresAt`، افتراضي 45 ث) يُرفض حتى لا يُشغَّل إعلان قديم بعد عودة جهاز منقطع. الأوامر مُعرّفة بـ `id` ويتجاهل الجهاز أي أمر مكرر.

## تنزيل الملفات
`GET /api/agent/files/:id` بنفس رمز الجهاز. الملف يُحفظ باسم `<sha256>.<ext>` ويُتحقق من البصمة قبل اعتماده (ملف تالف لا يُستخدم أبدًا).
