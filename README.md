# Pi Swarm

Persistent personas with **per-persona Telegram long polling**, durable Postgres messaging, and a control plane that keeps Telegram polling out of the Pi LLM process.

This repo implements the coding spec in `pi-swarm-persona-telegram-polling-spec.md`.

## Stack

- Node.js 22+, TypeScript (`strict: true`)
- PostgreSQL + Drizzle ORM
- Zod domain validation
- Pino structured logging
- Vitest tests

## Quick start (local)

```bash
cp .env.example .env
docker compose up -d postgres
npm install
npm run db:generate
npm run db:migrate
npm test
npm run dev
```

## CLI

Secret references only — never pass raw bot tokens on the CLI.

```bash
export TELEGRAM_CONCIERGE_TOKEN='...'   # local dev only

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

npm run cli -- persona telegram-enable \
  --persona concierge \
  --token-secret env://TELEGRAM_CONCIERGE_TOKEN \
  --allow-user 123456789 \
  --allow-chat 123456789 \
  --outbound replies_only

npm run cli -- persona start concierge
npm run cli -- persona status concierge
```

## Architecture

```text
Telegram Bot API
     │
     ▼
telegram-poller  ──► Postgres inbox (agent_messages)
     │                      │
     │                      ▼
     │               Pi RPC worker (PersonaWorker)
     │                      │
     ▼                      ▼
telegram-sender  ◄── outbox intents (telegram.send)
```

## Milestone status

- [x] Project scaffold, domain schemas, Postgres schema
- [x] Secret provider + token fingerprinting
- [x] Bridge lifecycle service + CLI skeleton
- [x] Lease manager, poller transactional dedupe, sender policy checks
- [x] Persona supervisor with fake worker + Pi RPC adapter stub
- [x] Inbox/outbox workers wired to poller and Telegram sender
- [x] Pi RPC worker wired to real Pi RPC process (Telegram → LLM → reply)
- [x] Remnic memory plane: scoped recall, curation worker, grants, audit
- [x] Telegram typing indicator during LLM replies (`sendChatAction`)
- [ ] Full integration tests with fake Telegram + Postgres

## Related

- Previous file-bus prototype: `pi-agent-swarm` (superseded for Telegram/persona runtime)
