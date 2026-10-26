#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  REC Smart Audio — تثبيت جهاز التشغيل المحلي على Linux (Ubuntu/Debian/Raspberry Pi OS)
#  الاستخدام (بدون sudo، بحساب المستخدم الذي سيشغّل الصوت):
#     ./install.sh --server https://audio.example.com --token rec_xxx
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SERVER=""
TOKEN=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --server) SERVER="$2"; shift 2 ;;
    --token)  TOKEN="$2";  shift 2 ;;
    *) echo "خيار غير معروف: $1"; exit 1 ;;
  esac
done

if [[ $EUID -eq 0 ]]; then
  echo "✘ شغّل السكربت بحساب مستخدم عادي (وليس root) — الخدمة تعمل داخل جلسة المستخدم لتصل إلى الصوت والبلوتوث."
  exit 1
fi

SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BASE="$HOME/rec-agent"
APP="$BASE/app"
VENV="$BASE/venv"
CONF="$BASE/config.toml"

echo "▶ التحقق من المتطلبات…"
if ! systemctl --user show-environment >/dev/null 2>&1; then
  echo "✘ لا توجد جلسة systemd للمستخدم. سجّل الدخول مباشرة (أو عبر SSH) بهذا المستخدم ثم أعد المحاولة."
  exit 1
fi
command -v python3 >/dev/null || { echo "✘ Python 3.10+ غير مثبت: sudo apt install python3 python3-venv"; exit 1; }
python3 - <<'PY' || { echo "✘ يلزم Python 3.10 أو أحدث"; exit 1; }
import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)
PY
python3 -m venv --help >/dev/null 2>&1 || { echo "✘ ثبّت: sudo apt install python3-venv"; exit 1; }
if ! command -v bluetoothctl >/dev/null; then
  echo "ℹ bluetoothctl غير موجود — مطلوب فقط عند استخدام سماعات بلوتوث: sudo apt install bluez"
fi
if ! command -v pactl >/dev/null && ! command -v wpctl >/dev/null; then
  echo "ℹ لم يُعثر على PipeWire/PulseAudio. للبلوتوث ثبّت: sudo apt install pipewire pipewire-pulse wireplumber libspa-0.2-bluetooth"
fi

echo "▶ نسخ البرنامج إلى $APP"
mkdir -p "$APP"
rsync -a --delete --exclude 'tests' --exclude '__pycache__' --exclude '*.pyc' "$SRC_DIR/rec_agent" "$APP/" 2>/dev/null \
  || { rm -rf "$APP/rec_agent"; cp -r "$SRC_DIR/rec_agent" "$APP/"; }
cp "$SRC_DIR/requirements.txt" "$APP/"
[[ -f "$SRC_DIR/README.md" ]] && cp "$SRC_DIR/README.md" "$APP/" || true

echo "▶ إنشاء البيئة الافتراضية وتثبيت المكتبات"
python3 -m venv "$VENV"
"$VENV/bin/pip" install --upgrade pip -q
"$VENV/bin/pip" install -r "$APP/requirements.txt" -q
# make `python -m rec_agent` work from any directory
SITE="$("$VENV/bin/python" -c 'import sysconfig; print(sysconfig.get_paths()["purelib"])')"
echo "$APP" > "$SITE/rec-agent.pth"

if [[ ! -f "$CONF" ]]; then
  [[ -z "$SERVER" ]] && read -rp "عنوان الخادم (https://…): " SERVER
  [[ -z "$TOKEN"  ]] && read -rsp "رمز الجهاز: " TOKEN && echo
  cp "$SRC_DIR/config.example.toml" "$CONF"
  echo "✔ تم إنشاء $CONF"
fi
# re-running with --server/--token updates them (e.g. after "New token" in the dashboard)
if [[ -n "$SERVER" ]]; then sed -i "s#^server_url = .*#server_url = \"${SERVER%/}\"#" "$CONF"; fi
if [[ -n "$TOKEN"  ]]; then sed -i "s#^token = .*#token = \"$TOKEN\"#" "$CONF"; fi
chmod 600 "$CONF"

echo "▶ تثبيت خدمة systemd للمستخدم"
mkdir -p "$HOME/.config/systemd/user"
cp "$SRC_DIR/install/linux/rec-agent.service" "$HOME/.config/systemd/user/rec-agent.service"
systemctl --user daemon-reload
systemctl --user enable rec-agent.service

echo "▶ تفعيل التشغيل التلقائي عند الإقلاع دون تسجيل دخول (linger)"
if ! loginctl show-user "$USER" -p Linger 2>/dev/null | grep -q yes; then
  sudo loginctl enable-linger "$USER" || echo "⚠ نفّذ يدويًا: sudo loginctl enable-linger $USER"
fi

"$VENV/bin/python" -m rec_agent --config "$CONF" --check || echo "⚠ الخادم غير متاح الآن — سيعيد البرنامج المحاولة تلقائيًا"
systemctl --user restart rec-agent.service
sleep 3
systemctl --user --no-pager status rec-agent.service | head -n 12 || true

cat <<EOF

✔ اكتمل التثبيت.
  • الحالة:          systemctl --user status rec-agent
  • السجل المباشر:   journalctl --user -u rec-agent -f
  • مخارج الصوت:     $VENV/bin/python -m rec_agent --config $CONF --list-outputs
  • نغمة اختبار:     $VENV/bin/python -m rec_agent --config $CONF --test-tone
  • فحص الصحة:       curl -s http://127.0.0.1:8765/health
EOF
