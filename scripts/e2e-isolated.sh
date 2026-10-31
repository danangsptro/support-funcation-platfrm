#!/usr/bin/env bash
# E2E browser di stack Docker terpisah (project sfp-e2e, volume sendiri) agar database demo tidak berubah.
# Pemakaian: pnpm test:e2e [argumen playwright]
# Tanpa argumen: suite penuh, lalu restart api + web dan uji persistence (@setelah-restart).
set -euo pipefail
cd "$(dirname "$0")/.."
PROJECT=sfp-e2e
export DB_HOST_PORT=5436 API_HOST_PORT=3006 WEB_HOST_PORT=8096
cleanup() {
  local code=$?
  # Gagal → simpan log api/web/db (berisi x-request-id & durasi per request) sebelum stack dan volumenya dihapus.
  if [ "$code" -ne 0 ]; then
    mkdir -p frontend/test-results
    docker compose -p "$PROJECT" logs --no-color --timestamps api web db > frontend/test-results/stack-logs.txt 2>&1 || true
    echo "Log stack E2E disimpan di frontend/test-results/stack-logs.txt"
  fi
  docker compose -p "$PROJECT" down -v >/dev/null 2>&1 || true
}
trap cleanup EXIT
docker compose -p "$PROJECT" down -v >/dev/null 2>&1 || true
docker compose -p "$PROJECT" up -d --build --wait
export E2E_ISOLATED=1 E2E_BASE_URL="http://localhost:${WEB_HOST_PORT}"
if [ "$#" -gt 0 ]; then
  pnpm --filter web exec playwright test "$@"
  exit
fi
# 1) Seluruh alur lewat UI. 2) Restart api + web (database & volume tetap). 3) Data dibaca ulang dari PostgreSQL.
pnpm --filter web exec playwright test --grep-invert @setelah-restart
docker compose -p "$PROJECT" restart api web
docker compose -p "$PROJECT" up -d --wait
E2E_SKIP_SETUP=1 pnpm --filter web exec playwright test --grep @setelah-restart
