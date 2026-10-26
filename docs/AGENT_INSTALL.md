# تثبيت جهاز التشغيل المحلي (Audio Agent)

> **الطريقة السهلة:** لوحة التحكم ← الأجهزة والسماعات ← إضافة جهاز ← انسخ الأمر الجاهز والصقه في PowerShell (Windows) أو الطرفية (Linux) على جهاز السماعات. الأمر ينزّل البرنامج من خادمك نفسه ويثبّت Python والخدمة تلقائيًا. إعادة تشغيل الأمر تحدّث البرنامج والرمز.
>
> ما يلي للتثبيت اليدوي.

الجهاز: أي كمبيوتر صغير يعمل 24/7 في الداتا سنتر (Mini PC، Intel NUC، Raspberry Pi 4/5، أو خادم) موصول بالسماعات/المضخم. يحتاج اتصالًا **صادرًا** فقط إلى الخادم عبر 443.

## قبل البدء
1. لوحة التحكم ← **الأجهزة والسماعات ← إضافة جهاز**. انسخ **الرمز** (يظهر مرة واحدة).
2. انسخ مجلد `agent/` من المشروع إلى الجهاز.
3. فعّل مزامنة الوقت (NTP) — دقة الأذان مرتبطة بساعة الجهاز.

---

## Windows 10/11 أو Windows Server

```powershell
# PowerShell كمسؤول
# Python و NSSM يُثبّتان تلقائيًا إن لم يوجدا
cd C:\path\to\agent
Set-ExecutionPolicy -Scope Process Bypass
.\install\windows\install.ps1 -Server "https://audio.example.com" -Token "rec_xxxxxxxx_..."
```
يقوم السكربت بـ:
- نسخ البرنامج إلى `C:\Program Files\REC-Audio-Agent` وإنشاء بيئة Python معزولة.
- إنشاء `C:\ProgramData\REC-Audio-Agent\config.toml` بصلاحيات للمسؤولين فقط.
- تسجيل خدمة **RECAudioAgent** (NSSM): بدء تلقائي مع الإقلاع، إعادة تشغيل عند أي توقف خلال 5 ثوانٍ، استرداد SCM كطبقة ثانية، اعتماد على خدمات الصوت. إن تعذّر تنزيل NSSM تُسجَّل **مهمة مجدولة** تبدأ مع الإقلاع وتُعاد كل دقيقة عند التوقف.
- تعطيل السكون/الإسبات على الكهرباء.

مع **البلوتوث** استخدم حساب المستخدم الذي أقرن السماعة: أضف `-ServiceUser ".\recaudio"`.

الأوامر المفيدة:
```powershell
Get-Service RECAudioAgent
Restart-Service RECAudioAgent
Get-Content C:\ProgramData\REC-Audio-Agent\logs\agent.log -Wait -Tail 50
Invoke-RestMethod http://127.0.0.1:8765/health
.\install\windows\uninstall.ps1
```

---

## Linux (Ubuntu / Debian / Raspberry Pi OS)

```bash
sudo apt install python3 python3-venv rsync
# للبلوتوث/الصوت الحديث:
sudo apt install pipewire pipewire-pulse wireplumber bluez libspa-0.2-bluetooth
cd agent
./install/linux/install.sh --server https://audio.example.com --token rec_xxxxxxxx_...
```
يعمل البرنامج كـ **systemd user service** داخل جلسة المستخدم (للوصول إلى PipeWire والبلوتوث)، مع `loginctl enable-linger` ليبدأ مع الإقلاع دون تسجيل دخول.
- `Restart=always` + `WatchdogSec=120`: يُعاد تشغيله عند أي توقف أو تجمّد.
- `Type=notify`: systemd يعرف أن الخدمة جاهزة فعلًا.

```bash
systemctl --user status rec-agent
journalctl --user -u rec-agent -f
systemctl --user restart rec-agent
curl -s http://127.0.0.1:8765/health | python3 -m json.tool
./install/linux/uninstall.sh
```

> Linux بدون واجهة رسومية وبدون PipeWire (ALSA مباشر، مثل AUX على خادم): يعمل كما هو. أضف المستخدم لمجموعة `audio`: `sudo usermod -aG audio $USER`.

---

## الإعدادات (`config.toml`)
راجع [`agent/config.example.toml`](../agent/config.example.toml). أهمها:
| المفتاح | الوصف |
|---|---|
| `server_url` | عنوان لوحة التحكم (https) |
| `token` / `token_file` | رمز الجهاز |
| `output_device` | يتجاوز اختيار لوحة التحكم (فارغ = من اللوحة) |
| `fallback_to_default_output` | إن غاب المخرج المطلوب يُستخدم الافتراضي بدل الصمت |
| `cache_all_files` | تنزيل كل المكتبة أو الأساسية فقط (الأذان + المجدولة) |
| `tls_verify` | `true`، أو مسار CA داخلي |
| `[bluetooth] mac` | لإعادة الاتصال التلقائي |

## ما الذي يضمن الاستمرارية؟
| الحالة | السلوك |
|---|---|
| إغلاق المتصفح / خروج المستخدم | لا تأثير — كل شيء يعمل على الجهاز والخادم |
| انقطاع الإنترنت | الجهاز يكمل الأذان والجداول من الخطة المخزنة (61 يومًا) ثم يحسب أم القرى محليًا؛ السجلات تُزامَن عند العودة دون تكرار |
| توقف الخادم/تحديثه | نفس السابق |
| إعادة تشغيل الجهاز | يبدأ تلقائيًا، يقرأ الإعدادات المخزنة، ولا يكرر حدثًا نُفّذ (مفاتيح محفوظة بـ fsync قبل التشغيل). إن عاد خلال 3 دقائق من دخول الوقت يُشغَّل الأذان، وإلا يُسجَّل «لم يُشغَّل» |
| تجمّد البرنامج | Watchdog داخلي يُنهي العملية بعد 90 ث، وsystemd/NSSM يعيدان تشغيلها |
| انقطاع البلوتوث | فحص دوري وإعادة اتصال وإعادة فتح المخرج ومتابعة الصوت من موضعه |
| تشغيل نسختين بالخطأ | قفل ملف يمنع النسخة الثانية (لا تكرار للأذان) |
