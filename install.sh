#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  REC Smart Audio — server installer (Ubuntu / Debian)
#
#  One command on a fresh server:
#     curl -fsSL https://raw.githubusercontent.com/__REPO__/main/install.sh | sudo bash
#  or, from a clone of the repository:
#     sudo ./install.sh
#  Non-interactive:  REC_DOMAIN=audio.example.com sudo -E ./install.sh
#
#  It installs Docker, asks for the domain (or offers a free sslip.io address),
#  generates secrets, starts the dashboard with automatic HTTPS, and prints the
#  address + a one-time setup code. Re-running it updates the installation.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

REPO="${REC_REPO:-__REPO__}"
UNSET="__RE""PO__"   # placeholder filled in automatically on GitHub (split so it is not replaced)
BRANCH="${REC_BRANCH:-main}"
DIR="${REC_DIR:-/opt/rec-smart-audio}"

c_ok=$'\e[32m'; c_info=$'\e[36m'; c_warn=$'\e[33m'; c_err=$'\e[31m'; c_off=$'\e[0m'
step() { echo; echo "${c_info}==> $1${c_off}"; }
ok()   { echo "    ${c_ok}✔ $1${c_off}"; }
warn() { echo "    ${c_warn}! $1${c_off}"; }
die()  { echo "${c_err}✘ $1${c_off}" >&2; exit 1; }
# read from the terminal even when the script itself comes from a pipe
ask() { local q="$1" def="${2:-}" a=""; { read -rp "$q" a </dev/tty; } 2>/dev/null || true; echo "${a:-$def}"; }

[[ $EUID -eq 0 ]] || die "Run with sudo / شغّل الأمر بـ sudo"
command -v apt-get >/dev/null || die "This installer supports Ubuntu/Debian. See docs/DEPLOY.md for other systems."

# ---------------------------------------------------------------- Docker
step "Docker"
if ! command -v docker >/dev/null; then
  apt-get update -qq && apt-get install -y -qq curl ca-certificates >/dev/null
  curl -fsSL https://get.docker.com | sh >/dev/null
fi
docker compose version >/dev/null 2>&1 || apt-get install -y -qq docker-compose-plugin >/dev/null
systemctl enable --now docker >/dev/null 2>&1 || true
ok "$(docker --version)"

# ---------------------------------------------------------------- source
step "Program files → $DIR"
SELF_DIR=""
# when piped through curl there is no script file
if [[ -n "${BASH_SOURCE[0]:-}" && -f "${BASH_SOURCE[0]}" ]]; then SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; fi
mkdir -p "$DIR"
if [[ -n "$SELF_DIR" && -f "$SELF_DIR/docker-compose.yml" && "$SELF_DIR" != "$DIR" ]]; then
  # running from a clone: copy it (keeps .env / backups in $DIR)
  tar -C "$SELF_DIR" --exclude=.git --exclude=node_modules --exclude=.env --exclude=backups -cf - . | tar -C "$DIR" -xf -
elif [[ -f "$DIR/docker-compose.yml" && -d "$DIR/.git" ]]; then
  git -C "$DIR" pull --ff-only
elif [[ -z "$SELF_DIR" || ! -f "$SELF_DIR/docker-compose.yml" ]]; then
  [[ "$REPO" == "$UNSET" ]] && die "Set REC_REPO=owner/repo or run ./install.sh from a clone of the repository."
  apt-get install -y -qq git >/dev/null
  if [[ -d "$DIR/.git" ]]; then git -C "$DIR" pull --ff-only
  else
    rm -rf "$DIR.tmp"
    if ! git clone -q --depth 1 -b "$BRANCH" "https://github.com/$REPO.git" "$DIR.tmp" 2>/dev/null; then
      die "Could not download https://github.com/$REPO (private repository?). Clone it yourself, then run: sudo ./install.sh"
    fi
    cp -a "$DIR.tmp/." "$DIR/" && rm -rf "$DIR.tmp"
  fi
fi
cd "$DIR"
ok "ready"

# ---------------------------------------------------------------- settings
step "Settings"
if [[ ! -f .env ]]; then
  IP="$(curl -fs4 --max-time 5 https://api.ipify.org 2>/dev/null || curl -fs4 --max-time 5 https://ifconfig.me 2>/dev/null || true)"
  SUGGEST=""
  [[ -n "$IP" ]] && SUGGEST="${IP//./-}.sslip.io"
  echo "    Domain name for the dashboard (its DNS must point to this server${IP:+: $IP})."
  echo "    اسم النطاق للوحة التحكم. بدون نطاق؟ اضغط Enter لاستخدام عنوان مجاني:"
  DOMAIN="${REC_DOMAIN:-}"
  [[ -n "$DOMAIN" ]] || DOMAIN="$(ask "    Domain [${SUGGEST:-audio.example.com}]: " "$SUGGEST")"
  [[ -n "$DOMAIN" ]] || die "A domain is required"
  ALPHABET='ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  CODE=""; for i in $(seq 1 8); do CODE+="${ALPHABET:$(( $(od -An -N2 -tu2 /dev/urandom) % ${#ALPHABET} )):1}"; done
  CODE="${CODE:0:4}-${CODE:4:4}"
  IMAGE=""
  [[ "$REPO" != "$UNSET" ]] && IMAGE="ghcr.io/$(echo "$REPO" | tr '[:upper:]' '[:lower:]'):latest"
  umask 077
  cat > .env <<EOF
DOMAIN=$DOMAIN
POSTGRES_PASSWORD=$(openssl rand -hex 24)
SETUP_CODE=$CODE
REC_IMAGE=$IMAGE
SESSION_TTL_HOURS=12
MAX_UPLOAD_MB=60
LOG_LEVEL=info
EOF
  ok ".env created (permissions 600)"
else
  ok "keeping existing .env"
fi
set -a; . ./.env; set +a
mkdir -p backups

# ---------------------------------------------------------------- firewall
if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
  ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null; ufw allow 443/udp >/dev/null
  ok "firewall: 80/443 opened"
fi

# ---------------------------------------------------------------- start
step "Starting (first time takes a few minutes)"
if [[ -n "${REC_IMAGE:-}" ]] && docker pull -q "$REC_IMAGE" >/dev/null 2>&1; then
  ok "using prebuilt image $REC_IMAGE"
  docker compose up -d --no-build --remove-orphans
else
  [[ -n "${REC_IMAGE:-}" ]] && warn "prebuilt image not available — building locally"
  sed -i 's#^REC_IMAGE=.*#REC_IMAGE=#' .env; export REC_IMAGE=""
  docker compose up -d --build --remove-orphans
fi

step "Waiting for the dashboard"
for i in $(seq 1 90); do
  if docker compose exec -T app node -e "fetch('http://127.0.0.1:4000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; then
    ok "running"; break
  fi
  sleep 2
  [[ $i -eq 90 ]] && { docker compose logs --tail 40 app; die "The app did not start — see the log above"; }
done

NEEDS_SETUP="$(docker compose exec -T app node -e "fetch('http://127.0.0.1:4000/api/setup/status').then(r=>r.json()).then(j=>console.log(j.needsSetup))" 2>/dev/null || echo false)"

echo
echo "${c_ok}════════════════════════════════════════════════════════════${c_off}"
echo "${c_ok}  REC Smart Audio is ready  |  النظام جاهز${c_off}"
echo "${c_ok}════════════════════════════════════════════════════════════${c_off}"
echo "  Dashboard / لوحة التحكم:   https://$DOMAIN"
if [[ "$NEEDS_SETUP" == *true* ]]; then
  echo "  Setup code / رمز الإعداد:  ${c_warn}$SETUP_CODE${c_off}"
  echo
  echo "  1. Open the address and enter the setup code to create the admin account."
  echo "     افتح الرابط وأدخل رمز الإعداد لإنشاء حساب مدير النظام."
fi
echo "  2. Devices > Add device: copy the one-line command to the speaker machine."
echo "     الأجهزة والسماعات > إضافة جهاز: انسخ الأمر إلى جهاز السماعات."
echo
echo "  (HTTPS certificate is issued on the first visit; if the page doesn't load yet, wait a minute.)"
echo "  Update later:  sudo bash $DIR/install.sh      Logs:  cd $DIR && docker compose logs -f app"
