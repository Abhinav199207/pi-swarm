#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ ! -f .env ]]; then
  cp .env.example .env
fi

export PATH="${PATH:-}"
if [[ -d /tmp/node-v22.19.0-linux-x64/bin ]]; then
  export PATH="/tmp/node-v22.19.0-linux-x64/bin:$PATH"
fi

docker compose up -d postgres
npm install
npm run db:migrate

ALLOW_USER="${TELEGRAM_ALLOW_USER:-8958101948}"
ALLOW_CHAT="${TELEGRAM_ALLOW_CHAT:-8958101948}"

npm run cli -- persona create \
  --slug concierge \
  --name "Concierge" \
  --role "Primary user-facing coordinator" \
  --prompt prompts/concierge.md \
  --memory persona/concierge \
  --workspace workspaces/concierge \
  --tools concierge-v1 \
  --model primary \
  --kind concierge

npm run cli -- persona create \
  --slug atlas-infra \
  --name "Atlas Infra" \
  --role "Infrastructure specialist" \
  --prompt prompts/atlas-infra.md \
  --memory persona/atlas-infra \
  --workspace workspaces/atlas-infra \
  --tools infra-v1 \
  --model primary \
  --kind persistent_persona

if [[ -n "${TELEGRAM_CONCIERGE_TOKEN:-}" ]]; then
  npm run cli -- persona telegram-enable \
    --persona concierge \
    --token-secret env://TELEGRAM_CONCIERGE_TOKEN \
    --allow-user "$ALLOW_USER" \
    --allow-chat "$ALLOW_CHAT" \
    --outbound replies_only
fi

if [[ -n "${TELEGRAM_ATLAS_TOKEN:-}" ]]; then
  npm run cli -- persona telegram-enable \
    --persona atlas-infra \
    --token-secret env://TELEGRAM_ATLAS_TOKEN \
    --allow-user "$ALLOW_USER" \
    --allow-chat "$ALLOW_CHAT" \
    --outbound replies_only
fi

echo "Bootstrap complete. Start with:"
echo "  PERSONA_SLUGS=concierge,atlas-infra npm run start"
