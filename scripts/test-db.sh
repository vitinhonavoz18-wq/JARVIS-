#!/usr/bin/env bash
# Aplica as migrations num Postgres temporário e roda os testes de RLS.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin | tail -1)}"
DIR="$(mktemp -d)"
PORT="${PGPORT_TEST:-55432}"
cleanup() { "$PGBIN/pg_ctl" -D "$DIR/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$DIR"; }
trap cleanup EXIT
RUNAS=()
if [ "$(id -u)" = "0" ]; then chown -R postgres "$DIR"; RUNAS=(sudo -u postgres); fi
"${RUNAS[@]}" "$PGBIN/initdb" -D "$DIR/data" -U postgres -A trust >/dev/null
"${RUNAS[@]}" "$PGBIN/pg_ctl" -D "$DIR/data" -o "-p $PORT -k $DIR -c listen_addresses=''" -w start >/dev/null
PSQL=(psql -h "$DIR" -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -q)
"${PSQL[@]}" -f "$ROOT/supabase/tests/auth_stub.sql"
for f in "$ROOT"/supabase/migrations/*.sql; do
  case "$f" in *storage_and_realtime*) continue ;; esac  # depende do Storage/Realtime do Supabase
  "${PSQL[@]}" -f "$f"
done
echo "Migration aplicada."
"${PSQL[@]}" -f "$ROOT/supabase/tests/rls_test.sql"
"${PSQL[@]}" -f "$ROOT/supabase/tests/rls_v2_test.sql"
"${PSQL[@]}" -f "$ROOT/supabase/tests/memory_test.sql"
# A reversão do Memory Engine remove só o que ela criou e pode ser reaplicada.
"${PSQL[@]}" -f "$ROOT/supabase/rollback/20261124000005_down.sql"
"${PSQL[@]}" -c "do \$\$ begin assert to_regclass('public.decision_history') is null; assert to_regclass('public.user_memories') is not null; end \$\$;"
"${PSQL[@]}" -f "$ROOT/supabase/migrations/20261124000005_memory_engine.sql"
echo "REVERSÃO E REAPLICAÇÃO DO MEMORY ENGINE OK"
# A reversão da 2.0 remove só o que ela criou e pode ser reaplicada.
"${PSQL[@]}" -f "$ROOT/supabase/rollback/20261120000004_down.sql"
"${PSQL[@]}" -c "do \$\$ begin assert to_regclass('public.automations') is null; assert to_regclass('public.tasks') is not null; end \$\$;"
"${PSQL[@]}" -f "$ROOT/supabase/migrations/20261120000004_intelligence_core.sql"
echo "REVERSÃO E REAPLICAÇÃO DA 2.0 OK"
