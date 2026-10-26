# REC Audio Agent

برنامج جهاز التشغيل المحلي: يشغّل الأذان والإعلانات على السماعات، ويستقبل أوامر لوحة التحكم عبر اتصال صادر آمن، ويعمل باستقلالية كاملة عند انقطاع الإنترنت.

- التثبيت: [../docs/AGENT_INSTALL.md](../docs/AGENT_INSTALL.md)
- ربط السماعات: [../docs/AUDIO_SETUP.md](../docs/AUDIO_SETUP.md)
- البروتوكول: [../docs/PROTOCOL.md](../docs/PROTOCOL.md)

## الوحدات
| الملف | الدور |
|---|---|
| `agent.py` | الربط بين المكونات، الاتصال بالخادم، تنفيذ الأوامر، حلقات الصحة والحالة |
| `controller.py` | **Audio Priority Queue**: صوت واحد في كل لحظة، الأذان أولًا، الاستئناف بعد المقاطعة |
| `scheduler.py` | الجدولة المحلية للأذان والإعلانات، منع التكرار، التعويض بعد إعادة التشغيل |
| `prayer_fallback.py` | حساب أم القرى محليًا عند تجاوز خطة الخادم (مطابق لحساب الخادم) |
| `recurrence.py` | تكرار الجداول (مرة/يومي/أسبوعي/نسبة لصلاة) |
| `player.py` | مخرج الصوت: pygame/SDL2 (حقيقي) أو null (محاكاة) |
| `cache.py` | تخزين الملفات محليًا مع التحقق من SHA-256 |
| `store.py` | SQLite: الإعدادات، الأحداث المنفّذة، السجلات غير المزامنة |
| `bluetooth.py` | إعادة الاتصال بسماعة البلوتوث |
| `watchdog.py` | Watchdog داخلي + systemd notify |
| `singleton.py` | منع تشغيل نسختين على نفس الجهاز |

## أوامر مفيدة
```bash
python -m rec_agent --config config.toml --list-outputs   # أسماء مخارج الصوت
python -m rec_agent --config config.toml --test-tone      # نغمة اختبار مباشرة
python -m rec_agent --config config.toml --check          # فحص الوصول للخادم
python -m pytest                                          # الاختبارات
```
