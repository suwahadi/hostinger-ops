#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if ! pg_lsclusters --no-header | awk '$1 == "17" && $2 == "main" && $4 == "online" { found = 1 } END { exit !found }'; then
  sudo pg_ctlcluster 17 main start
fi

for _ in $(seq 1 30); do
  if pg_isready -q -h 127.0.0.1 -p 5432; then
    break
  fi
  sleep 1
done
pg_isready -q -h 127.0.0.1 -p 5432

node .cursor/prepare-database.mjs
chmod 600 .env

api_port="${API_PORT:-3000}"
if [ -f .env ]; then
  file_port="$(awk -F= '$1 == "API_PORT" { print $2; exit }' .env)"
  if [ -n "$file_port" ]; then
    api_port="$file_port"
  fi
fi

if node --input-type=module -e '
import net from "node:net";
const port = Number(process.argv[1]);
const socket = net.connect({ host: "127.0.0.1", port });
const done = (code) => { socket.destroy(); process.exit(code); };
socket.setTimeout(1000);
socket.on("connect", () => done(0));
socket.on("timeout", () => done(1));
socket.on("error", () => done(1));
' "$api_port"; then
  echo "API already listening on 127.0.0.1:${api_port}"
  exit 0
fi

exec corepack pnpm dev:api
