#!/usr/bin/env bash
# REC Smart Audio - one-line installer for Linux (served by your server at /agent/install.sh)
#   curl -fsSL https://SERVER/agent/install.sh | bash -s -- --server https://SERVER --token rec_...
# Downloads the agent package from YOUR server, then runs install/linux/install.sh.
set -euo pipefail

SERVER=""; TOKEN=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --server) SERVER="${2%/}"; shift 2 ;;
    --token)  TOKEN="$2";  shift 2 ;;
    *) echo "unknown option: $1"; exit 1 ;;
  esac
done
[[ -z "$SERVER" || -z "$TOKEN" ]] && { echo "usage: ... | bash -s -- --server https://SERVER --token rec_..."; exit 1; }
if [[ $EUID -eq 0 ]]; then
  echo "✘ Run as a normal user (not root/sudo) — the agent runs inside that user's audio session."
  echo "  شغّل الأمر بحساب مستخدم عادي وليس root"
  exit 1
fi

need=()
command -v python3 >/dev/null || need+=(python3)
python3 -c "import venv, ensurepip" 2>/dev/null || need+=(python3-venv)
command -v tar >/dev/null || need+=(tar)
if [[ ${#need[@]} -gt 0 ]]; then
  if command -v apt-get >/dev/null; then
    echo "==> Installing: ${need[*]} (sudo)"
    sudo apt-get update -qq && sudo apt-get install -y -qq "${need[@]}"
  else
    echo "✘ Please install: ${need[*]}"; exit 1
  fi
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
echo "==> Downloading agent package from $SERVER"
curl -fsSL "$SERVER/agent/rec-agent.tar.gz" | tar -xz -C "$WORK"
bash "$WORK/install/linux/install.sh" --server "$SERVER" --token "$TOKEN" </dev/null
