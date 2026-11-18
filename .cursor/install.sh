#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

export DEBIAN_FRONTEND=noninteractive

if ! command -v psql >/dev/null 2>&1 || ! psql --version | grep -q ' 17\.'; then
  sudo apt-get update
  sudo apt-get install -y curl ca-certificates gpg
  sudo install -d /usr/share/postgresql-common/pgdg
  key=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc
  sudo curl -fsSL -o "$key" --fail https://www.postgresql.org/media/keys/ACCC4CF8.asc
  sudo chmod a+r "$key"
  expected=B97B0AFCAA1A47F044F244A07FCC7D46ACCC4CF8
  actual="$(gpg --show-keys --with-colons "$key" | awk -F: '/^fpr:/ { print $10; exit }')"
  if [ "$actual" != "$expected" ]; then
    echo "PostgreSQL apt key fingerprint does not match the published fingerprint" >&2
    exit 1
  fi
  codename="$(. /etc/os-release && printf '%s' "$VERSION_CODENAME")"
  sudo tee /etc/apt/sources.list.d/pgdg.sources >/dev/null <<EOF
Types: deb
URIs: https://apt.postgresql.org/pub/repos/apt
Suites: ${codename}-pgdg
Architectures: amd64
Components: main
Signed-By: ${key}
EOF
  sudo apt-get update
  sudo apt-get install -y postgresql-17
fi

corepack pnpm install --frozen-lockfile
corepack pnpm build
