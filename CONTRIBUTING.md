# Contributing

Thanks for helping build TimeCapsule.fm. This guide covers working on the code; to contribute *recordings*, use the site itself.

## Setup

```sh
npm i -g pnpm@10.34.9
pnpm install
pnpm test          # unit, database, API and worker tests (no Docker needed)
```

The full stack (Postgres/PostGIS, storage, worker, web) runs with Docker. See the [README](README.md).

## Workflow

1. Branch from `main`: `feat/…`, `fix/…`, `docs/…`.
2. Keep changes focused, and include tests with behaviour changes.
3. Before pushing: `pnpm lint && pnpm typecheck && pnpm test`. If you changed API routes, also run `pnpm openapi:export` and commit `docs/openapi.json`.
4. Open a pull request using the template. CI must pass.

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/), e.g. `feat(api): add takedown resolution endpoint`.

## Rules that are not negotiable

- **Provenance first.** Never display a recording without complete provenance. Never present reconstructed or synthetic audio as authentic.
- **Authorization on the server.** Every API route declares `config.access`. Data rules live in the database (RLS, constraints, triggers) as well as the API.
- **Privacy.** No raw IPs, emails, query strings or signed URLs in logs. Locations are stored only at the contributor's chosen precision.
- **Migrations are forward-only.** Never edit an applied migration; add a new one.
- **User text is text.** Render it as text nodes only; never inject HTML.
- **Translations.** Every UI string goes in `apps/web/messages/*.json`, and all three catalogs keep the same keys (a test checks this).

## Reporting security issues

Please don't open a public issue. See [SECURITY.md](SECURITY.md).
