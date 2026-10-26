# نشر لوحة التحكم على استضافة سحابية

> **الطريقة السهلة:** أمر واحد على خادم Ubuntu — راجع [README](../README.md#1-الخادم--أمر-واحد):
> `curl -fsSL https://raw.githubusercontent.com/itrasmala/rec-smart-audio/main/install.sh | sudo bash`
> يقوم بكل الخطوات أدناه تلقائيًا. هذا المستند للنشر اليدوي والتفاصيل.

الخادم ولوحة التحكم وقاعدة البيانات تُنشر معًا بـ Docker Compose على أي خادم Linux (VPS) — مثلًا مزود سحابي داخل المملكة لتقليل زمن الاستجابة ولمتطلبات سيادة البيانات.

## المتطلبات
- خادم Ubuntu 22.04/24.04: 2 vCPU، 2–4 GB RAM، 20 GB تخزين (يكفي مئات الملفات الصوتية).
- نطاق فرعي، مثل `audio.rasmala.com.sa`، بسجل `A` يشير إلى IP الخادم.
- المنافذ 80 و443 مفتوحة للإنترنت (80 لإصدار شهادة Let's Encrypt فقط ثم التحويل لـ HTTPS).

## الخطوات
```bash
# 1. Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER && newgrp docker

# 2. المشروع
git clone <repo> rec-smart-audio && cd rec-smart-audio     # أو انسخ الملفات
cp .env.example .env
nano .env        # DOMAIN، POSTGRES_PASSWORD (openssl rand -hex 24)، SETUP_CODE

# 3. التشغيل (يبني الصورة، يطبّق الترحيلات، يصدر الشهادة تلقائيًا)
docker compose up -d --build
docker compose logs -f app       # انتظر: "Server listening at http://0.0.0.0:4000"

# 4. حساب مدير النظام الأول: افتح https://audio.example.com وأدخل SETUP_CODE من ملف .env
#    (أو من سطر الأوامر: docker compose exec app node dist/scripts/create-admin.js)
```

## جدار الحماية
```bash
sudo ufw default deny incoming
sudo ufw allow 22/tcp   # يفضّل تقييده بعنوان IP المؤسسة
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```
قاعدة البيانات وتطبيق Node غير منشورين على أي منفذ خارجي؛ الوصول الوحيد عبر Caddy.

## التحديث
```bash
git pull
docker compose up -d --build      # الترحيلات تُطبَّق تلقائيًا عند بدء الحاوية
```
أجهزة التشغيل تعيد الاتصال تلقائيًا خلال ثوانٍ، وتستمر بتشغيل الأذان أثناء التحديث من خطتها المخزنة.

## النسخ الاحتياطي والاستعادة
- خدمة `backup` تحفظ نسخة يومية في `./backups` (14 يومًا). انسخ المجلد خارج الخادم.
- الملفات الصوتية في وحدة التخزين `audio`:
  `docker run --rm -v rec-smart-audio_audio:/d -v $PWD:/b alpine tar czf /b/audio.tgz -C /d .`
- الاستعادة:
  ```bash
  docker compose exec -T db pg_restore -U rec -d rec_audio --clean < backups/rec_audio_2026-10-25.dump
  ```

## بدون Docker (اختياري)
```bash
# Node 20.19+ و PostgreSQL 16
cd web && npm ci && npm run build                 # ينتج web/out
cd ../server && npm ci && cp .env.example .env    # اضبط DATABASE_URL, WEB_DIR=../web/out, COOKIE_SECURE=true, PUBLIC_ORIGIN
npx prisma migrate deploy && npm run build
node dist/scripts/create-admin.js
node dist/index.js                                 # خلف Nginx/Caddy مع HTTPS ودعم WebSocket
```
مثال Nginx: يجب تمرير `Upgrade` و`Connection` لمساري `/ws` و`/ws/agent`، و`proxy_read_timeout 3600s`، و`client_max_body_size 64m`.

## تشغيل داخلي فقط (بدون سحابة)
يمكن تشغيل نفس `docker compose` على خادم داخل الداتا سنتر. للوصول من خارج المؤسسة استخدم VPN المؤسسة أو Cloudflare Tunnel بدل فتح منافذ واردة. راجع [SECURITY.md](SECURITY.md).
