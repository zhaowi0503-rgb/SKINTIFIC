#!/bin/zsh

set -euo pipefail

ROOT="/Users/skintific"
ENV_FILE="$ROOT/private/secrets/marketplace-daily-publisher.env"
export HOME="/Users/weizhao"
export PATH="/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:/Users/weizhao/Downloads/google-cloud-sdk/bin"
export CLOUDSDK_PYTHON="/usr/local/bin/python3"
export HTTP_PROXY="${HTTP_PROXY:-http://127.0.0.1:7890}"
export HTTPS_PROXY="${HTTPS_PROXY:-http://127.0.0.1:7890}"
export ALL_PROXY="${ALL_PROXY:-socks5h://127.0.0.1:7890}"
export NO_PROXY="${NO_PROXY:-localhost,127.0.0.1,::1}"
NODE="$(command -v node || true)"

if [[ -z "$NODE" ]]; then
  NODE="/usr/local/bin/node"
fi

if [[ -f "$ENV_FILE" ]]; then
  set -a
  source "$ENV_FILE"
  set +a
fi

mkdir -p "$ROOT/archive/logs"

if [[ "$#" -eq 0 ]]; then
  set -- --scheduled
fi

exec "$NODE" \
  "$ROOT/automations/marketplace-sales-daily/publish/publish_marketplace_period_to_gcs.js" \
  "$@"
