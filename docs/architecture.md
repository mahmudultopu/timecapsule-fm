# Architecture

This is the design agreed before implementation, updated with what changed during the build.

## Components

```
browser ──► Caddy (single origin) ──► /api/*  ──► API (Fastify) ──┐
                                  └─► /*      ──► Web (Next.js) ──┼──► Postgres + PostGIS (RLS)
                                                                  │
browser ──signed PUT──► quarantine bucket ──► worker (ffmpeg) ────┤   (LISTEN/NOTIFY + polling)
browser ──signed GET──► media bucket      ◄── worker writes ──────┘
worker ──► SMTP (notification emails)       web ──► SMTP (sign-in links)
```

| Concern | Choice |
|---|---|
| Monorepo | pnpm workspaces and Turborepo. Exact pins, 7-day `minimumReleaseAge`, dependency install scripts off unless allow-listed |
| Frontend | Next.js 16 (App Router), Tailwind 4, next-intl 4 (cookie or Accept-Language locale, no URL prefix). Translation keys are type-checked against the English catalog |
| Design | Self-hosted variable fonts (Fraunces, Inter). Tokens in `globals.css` meet WCAG 2.2 AA, enforced by `test/design.test.ts`. Every animation is disabled under `prefers-reduced-motion` |
| API | Fastify 5 and Zod 4. The OpenAPI 3.1 spec is generated from the route schemas ([openapi.json](openapi.json)) |
| DB | PostgreSQL 17 with PostGIS and pg_trgm. Forward-only SQL migrations with a small runner. Kysely, parameterized only |
| Auth | Auth.js v5 with database sessions in our Postgres. Email magic link over SMTP, plus GitHub/Google when configured. **No passwords.** OAuth tokens are dropped before storage |
| Storage | S3 API: R2 in production, SeaweedFS locally. Two private buckets (`media`, `quarantine`). Browsers only receive signed URLs |
| Jobs | The `uploads` table is the queue: the worker claims rows with `FOR UPDATE SKIP LOCKED`, is woken by `NOTIFY tc_uploads`, and polls as a fallback. This replaces the proposal's pg-boss: one less dependency and schema, with the same guarantees |
| Map | MapLibre GL 6. **Production uses a self-hosted PMTiles style**; development uses OpenFreeMap |
| Audio | `<audio crossorigin>` streams signed URLs (range requests) through a Web Audio `MediaElementSource → Gain` graph. The waveform is drawn from precomputed peaks |
| Rate limits | Fixed-window counters in Valkey/Redis, per IP **and** per account (API and the web app's sign-in) |
| Observability | pino JSON logs with redaction, Sentry (no PII), Prometheus `/metrics` (playback starts, uploads, moderation decisions and wait time, takedowns, HTTP latency) |

## Contribution flow

1. The browser sniffs the file's magic bytes and checks size and duration for fast feedback.
2. `POST /v1/submissions/:id/upload-intent` creates an `uploads` row and returns a 15-minute signed PUT into **quarantine**. The declared size and type are part of the signature.
3. The browser uploads straight to storage, showing a progress bar.
4. `upload-complete` checks the stored object is exactly the declared size, marks the upload `received`, moves the recording to `processing`, and sends a `NOTIFY`.
5. The **worker** processes the upload:
   - re-checks magic bytes against the declared format;
   - runs `ffprobe` forced to that demuxer, under protocol and format allow-lists;
   - enforces 1 s – 30 min of actual audio;
   - transcodes with all metadata stripped (`-map 0:a:0 -map_metadata -1 -map_chapters -1 -fflags +bitexact`) into a FLAC master and a 160 kbps MP3 preview;
   - computes peaks;
   - **re-probes the outputs and refuses to publish if any tag survived**;
   - swaps the assets and marks the recording `ready` in one transaction;
   - deletes the original, keeping only its SHA-256.

   On any failure the upload is `rejected` with a reason code. The contributor is notified, and the event is audited.
6. The contributor fills in metadata, which autosaves and stays editable while processing. They accept the current agreement (version and time are stored) and submit.
7. A **moderator** listens, ticks the four-point checklist, and approves (publish) or rejects with a reason. The contributor is notified in-app and by email.
8. Anyone can file a **takedown**. A moderator unpublishes the recording or declines the request; either way the action, note, moderator and time are recorded.

## Data model

All of it lives in `packages/db/migrations/`.

- **Era vs capture date.** `era_year` is the year a recording represents; `captured_from`/`captured_to` record when the audio was actually made. A CHECK constraint requires every non-reconstruction to have its era inside its capture range. A recording made in 2026 can't be presented as "Tokyo 1982" unless it is labelled `community_reconstruction`, and a reconstruction must carry a `synthetic_disclosure`.
- **Provenance is enforced in the database.** Nothing in review or public lacks a provenance field (`recorder_name` NULL means "unknown"). Disputed rights can never be published.
- **Location privacy.** A BEFORE trigger snaps each point to the chosen grid (≈100 m, 1 km or 10 km) before it is written. The longitude step widens with latitude. ~100 m requires `public_place_attested`. `shared/src/geo.ts` mirrors the function, and a test compares the two at 60 points.
- **State machine (`recordings_guard`).**
  - The **worker** may only finish processing.
  - The **owner** may edit content while `draft`/`processing`/`ready`/`processing_failed`/`rejected`, and may submit or withdraw but never publish.
  - **Moderators** change status only, and publishing or rejecting needs a matching review row.
  - Moderators can't review their own work.
- **Statuses.** `draft → processing → ready → pending_review → published | rejected`, plus `processing_failed` and `published ⇄ unpublished`.
- **Uploads** may only be moved `pending → received/expired` by the API; everything after that belongs to the worker.
- **Notifications** are an outbox. The worker emails them via a SECURITY DEFINER lookup that returns an address only if the user still wants email.
- **IDs** are random UUIDv4. Public endpoints return only published rows, and unpublished or unknown IDs both return 404.

## Authorization: three layers

1. **Route declaration.** Every route declares `config.access` (`public` | `user` | `moderator`); a route without it fails at startup.
2. **RLS.** Each service has its own login role:

   | Role | Access |
   |---|---|
   | `tc_api_login` | No BYPASSRLS, owns nothing. Each request runs in a transaction with `set_config('app.user_id', …, true)`, and roles are looked up in the DB |
   | `tc_worker_login` | Only uploads and recordings being processed |
   | `tc_auth_login` | Only the auth tables, plus insert-only on the audit log |

3. **Triggers and constraints** for transitions and column ownership.

Column grants keep emails and OAuth data out of the API's reach entirely.

## Decisions (approved defaults, plus the three left open)

| # | Decision | Where |
|---|---|---|
| 1 | Auth.js, database sessions, no passwords | `apps/web/src/auth.ts` |
| 2 ⚖️ | Precision tiers of 100 m / 1 km / 10 km; default 1 km; 100 m only with a public-place attestation | `0003`, `0006`, `LocationPicker` |
| 3 ⚖️ | Originals deleted after transcode; only the SHA-256 is kept | `apps/worker/src/pipeline.ts` |
| 4 ⚖️ | No raw IPs in the DB; the audit log stores an HMAC (`AUDIT_IP_HMAC_KEY`, rotate it), purged after 90 days | `audit.ts`, `security-log.ts` |
| 5 ⚖️ | Placeholder agreement marked **DRAFT**; `agreement:publish` refuses to publish text that still says DRAFT. Licenses: CC0, CC BY/BY-SA/BY-NC/BY-NC-SA 4.0, archive permission | `seed/agreement-draft.md`, `cli/publish-agreement.ts` |
| 6 ⚖️ | Self-hosted PMTiles in production | `MAP_STYLE_URL` |
| 7 ⚖️ | Seed data is synthetic and labelled everywhere; refused in production | `packages/db/seed` |
| 9 ⚖️ | Placeholder DMCA agent and contact | `/legal/takedown` |
| 10 ⚖️ | 16+ attestation at onboarding; Sentry collects no PII | `/welcome`, `server.ts` |
| Open → resolved | **Email provider:** generic SMTP (`SMTP_URL`), so any provider or relay works; Mailpit locally | web + worker |
| Open → resolved | **OAuth:** GitHub/Google appear only when their credentials are set | `auth.ts` |
| Open → resolved | **Licenses:** the list above, unchanged | `shared/src/enums.ts` |

## Production map tiles

1. Download a `.pmtiles` extract from Protomaps.
2. Upload it with its style, glyphs and sprites to a bucket or CDN on your domain.
3. Set `MAP_STYLE_URL` (and `MAP_ORIGINS` if it's another origin). The CSP picks the origins up automatically.
