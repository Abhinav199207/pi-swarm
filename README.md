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
  --allow-group-chats \
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

## Telegram media delivery

Personas can send **video, audio, and voice notes** outbound via `MEDIA:` markers in replies:

```text
Here is the clip.
MEDIA:/home/lenovo-docker/pi-swarm/workspaces/concierge/render.mp4
```

| Extension | Telegram API |
|-----------|--------------|
| `.mp4`, `.mov`, `.webm`, `.mkv`, `.avi` | `sendVideo` |
| `.mp3`, `.wav`, `.m4a`, `.flac`, `.aac` | `sendAudio` |
| `.ogg`, `.opus` | `sendVoice` |

**Channels and groups:** pass `--allow-group-chats` to `persona telegram-enable` and include the channel chat ID (`-100…`) in `--allow-chat`. The bot must be a channel admin with **Post Messages**.

**TTS voice replies** still require the user to send a voice note first (`inputModality === "voice"`).

Live deploy on Lenovo: pull `github-projects/pi-swarm` → sync to `~/pi-swarm` → `npm run build` → restart daemon (`homelab-deploy/deploy_pi_swarm_media_lenovo.py`).

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
- [x] Telegram outbound video/audio/voice via `MEDIA:` markers + channel support
- [ ] Full integration tests with fake Telegram + Postgres

## Related

- Previous file-bus prototype: `pi-agent-swarm` (superseded for Telegram/persona runtime)
