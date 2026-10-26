#!/usr/bin/env bash
set -euo pipefail
systemctl --user disable --now rec-agent.service 2>/dev/null || true
rm -f "$HOME/.config/systemd/user/rec-agent.service"
systemctl --user daemon-reload
echo "✔ تمت إزالة الخدمة. البيانات والإعدادات باقية في ~/rec-agent و ~/.local/state/rec-agent (احذفها يدويًا عند الحاجة)."
