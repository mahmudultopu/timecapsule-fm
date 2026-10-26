# Security policy

## Reporting a vulnerability

Please report security issues privately through GitHub's **Report a vulnerability** button (Security → Advisories) on this repository. Don't open a public issue.

Include what you found, how to reproduce it, and the impact you expect. We'll acknowledge within a few working days and keep you updated until it's resolved.

## Scope

In scope:

- authorization bypasses;
- access to unpublished recordings, or to audio without a valid signed URL;
- recovery of precise contributor locations or embedded file metadata;
- upload pipeline or transcoding exploits;
- XSS, CSRF and injection;
- leaks of personal data in logs or responses.

Out of scope: findings that need a compromised device or browser, missing best-practice headers that don't lead to an exploit, and rate-limit tuning on non-sensitive endpoints.

## Design notes

The threat model and mitigations are documented in [docs/threat-model.md](docs/threat-model.md).

## Takedown requests

Copyright or privacy complaints about a *recording* are not security issues. Use the takedown form on the site (`/legal/takedown`).
