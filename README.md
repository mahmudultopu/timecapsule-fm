# TimeCapsule.fm

[![CI](https://github.com/mahmudultopu/timecolapse/actions/workflows/ci.yml/badge.svg)](https://github.com/mahmudultopu/timecolapse/actions/workflows/ci.yml)
![Node 24](https://img.shields.io/badge/node-24-339933)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6)

An interactive map of ambient and environmental sound recorded in specific places across the decades. Every recording carries full provenance. Anything synthetic is labelled as a reconstruction, never presented as authentic.

**Status:** all four slices are built and tested:

- **Browse & play:** map, list, recording pages, persistent player.
- **Contribute:** sign-in, signed uploads, a sandboxed transcoding worker, the metadata editor.
- **Moderate:** review queue with a checklist, plus contributor notifications by email and in-app.
- **Takedown:** public request form and moderator resolution.

See [docs/architecture.md](docs/architecture.md) and [docs/threat-model.md](docs/threat-model.md).

## Layout

```
apps/web        Next.js 16: map, list, recording pages, contribute editor, moderation, account, auth
apps/api        Fastify REST API; OpenAPI at /docs (non-production) and docs/openapi.json
apps/worker     Transcoding worker: validates, strips metadata, transcodes (ffmpeg), sends emails
packages/shared Zod schemas, enums, provenance/geo/upload rules shared by every app
packages/db     SQL migrations (PostGIS, RLS, triggers), migration runner, Kysely types, seed, CLIs
e2e             Playwright: browse, play, contribute → moderate → publish → takedown (with axe checks)
infra           docker-compose, Postgres role bootstrap, Caddy, object-storage config
docs            Architecture, threat model, OpenAPI spec
```

## Requirements

- Node 24, pnpm 10.34.9 (`npm i -g pnpm@10.34.9`)
- Docker for the full stack
- ffmpeg on PATH only if you run the worker outside Docker

Unit, DB and API tests need neither Docker nor Postgres. They run against PGlite, a real Postgres with PostGIS compiled to WebAssembly.

## Quick start (full stack)

```sh
pnpm install
docker compose -f infra/docker-compose.yml up --build -d --wait
docker compose -f infra/docker-compose.yml --profile seed run --rm seed   # 5 synthetic demo recordings + draft agreement
```

| What | Where |
|---|---|
| App | http://localhost:8080 |
| Sign-in links and notification emails | http://localhost:8025 (Mailpit) |
| Make yourself a moderator | `docker compose -f infra/docker-compose.yml exec postgres psql -U postgres timecapsule -c "UPDATE users SET role='moderator' WHERE email='you@example.com'"` |

## Development

```sh
pnpm test             # all unit, DB, API-integration and worker tests
pnpm lint && pnpm typecheck
pnpm openapi:export   # regenerate docs/openapi.json (CI fails if it is stale)
E2E_BASE_URL=http://localhost:8080 E2E_DATABASE_URL=postgres://postgres:dev-superuser-password@localhost:5432/timecapsule pnpm e2e
```

To run the apps outside Docker, copy `.env.example` to `.env`, then:

```sh
pnpm db:migrate
pnpm --filter @timecapsule/db storage:init
pnpm db:seed
pnpm --filter @timecapsule/api dev
pnpm --filter @timecapsule/worker dev
pnpm --filter @timecapsule/web dev
```

Without SMTP in development, sign-in links are printed to the web server's console.

## Demo deployment (Vercel)

The web app can run on its own in **demo mode** (`DEMO_MODE=true`). The read-only API endpoints are then answered from the five bundled synthetic recordings, and the audio is generated at build time. Browsing, the map and the player work; sign-in, uploads and moderation show a "needs the full backend" notice, and a banner marks the site as a demo.

Vercel project settings:

| Setting | Value |
|---|---|
| Root directory | `apps/web` (`apps/web/vercel.json` sets the install and build commands) |
| Node.js | 24.x |
| `DEMO_MODE` | `true` |
| `MAP_STYLE_URL` | `https://tiles.openfreemap.org/styles/positron` |
| `AUTH_SECRET` | a random 32+ character value |
| `AUTH_TRUST_HOST` | `true` |
| `ENABLE_EXPERIMENTAL_COREPACK` | `1` (uses the pinned pnpm) |

The full product (accounts, uploads, transcoding, moderation) needs the API, worker, Postgres/PostGIS, object storage and Redis, deployed with the Docker images in this repo.

## Operations

| Task | Command |
|---|---|
| Apply migrations (as the schema owner) | `pnpm db:migrate` |
| Create buckets and CORS rules | `pnpm --filter @timecapsule/db storage:init` |
| Publish the reviewed contributor agreement | `pnpm --filter @timecapsule/db agreement:publish 2026-11-01 ./agreement.md` |
| Metrics | `GET /metrics` on the API (bearer `METRICS_TOKEN`, internal network only) |

## Security at a glance

- **Authorization in three layers.** Every route must declare its access level, Postgres row-level security covers every table, and triggers enforce who may change what.
- **Uploads.** Files go straight to a private quarantine bucket via signed PUTs, with size and type part of the signature. The worker checks magic bytes, probes with ffmpeg under protocol and demuxer allow-lists, strips every metadata tag (verified on the output), and deletes the original.
- **Location privacy.** Coordinates are snapped to the contributor's chosen precision before storage. The ~100 m tier is allowed only for attested public places.
- **Media.** Buckets are private; audio is served through signed URLs that expire in 5–15 minutes.
- **Browser hardening.** Nonce CSP, HSTS, nosniff, `frame-ancestors 'none'` and a restrictive Permissions-Policy.
- **CSRF.** Origin check plus double-submit token.
- **Rate limits.** Per IP and per account on sign-in, uploads, search and takedowns.
- **Privacy in logs.** No IPs, query strings, cookies, emails or signed URLs in logs. The audit log keeps HMAC'd IPs.

## Before launch ⚖️

- The contributor agreement is a placeholder draft. Publish the legally reviewed text with `agreement:publish`.
- The DMCA designated agent and contact address (`TAKEDOWN_EMAIL`) are placeholders. Register the agent with the U.S. Copyright Office.
- Set `MAP_STYLE_URL` to a self-hosted PMTiles style.
- Configure SMTP, and optionally GitHub/Google sign-in.
- The Arabic and Japanese UI strings were machine-drafted and need native-speaker review.

## Seed data

The five demo recordings are **procedurally generated noise and tones**. They are labelled `community_reconstruction`, prefixed `[DEMO — synthetic placeholder]`, flagged `is_demo`, and each disclosure says it is not a recording of the place or era. The seed refuses to run with `NODE_ENV=production`.
