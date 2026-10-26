## What and why

<!-- What does this change, and why is it needed? Link the issue if there is one. -->

## How it was tested

<!-- Tests added or updated; manual checks. -->

## Checklist

- [ ] `pnpm lint && pnpm typecheck && pnpm test` pass
- [ ] New or changed UI strings are in all three message catalogs
- [ ] API changes: `pnpm openapi:export` run and `docs/openapi.json` committed
- [ ] Schema changes: a new forward-only migration (no edits to applied ones)
- [ ] No personal data, signed URLs or secrets in logs, fixtures or commits
- [ ] Provenance and reconstruction labelling still hold for anything user-visible
