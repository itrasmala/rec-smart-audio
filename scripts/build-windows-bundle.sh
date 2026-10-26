#!/usr/bin/env bash
# Builds the ready-to-run package used by install-windows.ps1 (one PC, no server):
#   app/node.exe          Node.js runtime (copied from the build machine; Windows build in CI)
#   app/server            compiled server + production dependencies (built-in database included)
#   app/web/out           dashboard (static)
#   app/agent             speaker agent (installed by the agent installer)
# Usage: scripts/build-windows-bundle.sh <output-dir>
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${1:-$ROOT/bundle}"
rm -rf "$OUT"
mkdir -p "$OUT/app/server" "$OUT/app/web" "$OUT/app/agent"

echo "==> dashboard"
(cd "$ROOT/web" && npm ci --no-audit --no-fund && npm run build)
cp -r "$ROOT/web/out" "$OUT/app/web/"

echo "==> server"
(cd "$ROOT/server" && npm ci --no-audit --no-fund && npx prisma generate && npx tsc -p .)
cp -r "$ROOT/server/dist" "$ROOT/server/prisma" "$ROOT/server/package.json" "$ROOT/server/package-lock.json" "$OUT/app/server/"
(cd "$OUT/app/server" && npm ci --omit=dev --ignore-scripts --no-audit --no-fund)

echo "==> trimming build-only packages"
NM="$OUT/app/server/node_modules"
rm -rf "$NM/prisma" "$NM/.bin" "$NM/@types" "$NM/typescript" "$NM/effect" "$NM/react" "$NM/react-dom" "$NM/elkjs" "$NM/@radix-ui"
rm -rf "$NM/@prisma/studio-core" "$NM/@prisma/dev" "$NM/@prisma/engines" "$NM/@prisma/engines-version" \
       "$NM/@prisma/fetch-engine" "$NM/@prisma/get-platform" "$NM/@prisma/config"
find "$NM/@prisma/client/runtime" \( -name '*cockroachdb*' -o -name '*mysql*' -o -name '*sqlserver*' -o -name '*sqlite*' \) -delete
find "$NM" \( -name '*.map' -o -name '*.d.ts' -o -name '*.d.mts' -o -name '*.d.cts' \) -delete
# test fixtures are never loaded at runtime; some use non-ASCII names that Windows unzip tools reject
find "$NM" -mindepth 2 -maxdepth 3 -type d \( -name test -o -name tests -o -name __tests__ \) -prune -exec rm -rf {} +
LC_ALL=C find "$OUT/app" -name '*[^ -~]*' -prune -exec rm -rf {} +

echo "==> agent"
cp -r "$ROOT/agent/rec_agent" "$ROOT/agent/install" "$ROOT/agent/requirements.txt" \
      "$ROOT/agent/config.example.toml" "$ROOT/agent/README.md" "$OUT/app/agent/"
find "$OUT/app/agent" -name '__pycache__' -prune -exec rm -rf {} +

if [[ -n "${NODE_EXE:-}" ]]; then cp "$NODE_EXE" "$OUT/app/node.exe"; fi
cp "$ROOT/install-windows.ps1" "$ROOT/uninstall-windows.ps1" "$OUT/"
echo "==> done: $OUT"
