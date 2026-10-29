# Telegram authentication validation — 2026-10-29

Phone grants: normalization/invalid formats, verified claim requirement, account
pinning against number reuse, immediate revocation, explicit disabled ID priority,
session-link cascade cleanup, administrator-only grant/list/revoke integration.

- Domain tests: payments, gifts, costs, menu calculator, invalid input.
- Signed JWT tests: wrong signature, issuer, audience, expiry and nonce rejected.
- Disposable local D1: concurrent writes, persistence, idempotency, rollback,
  per-unit issue/undo, statistics, portable backup/restore and ETag.
- Security integration: anonymous and forged identities denied; CSRF/origin
  enforced; staff roles filtered server-side; no self-promotion to administrator;
  access revocation invalidates existing sessions.
- Chrome and WebKit: guest page, authenticated cashier, queues, report/PDF,
  menu editor, calculator, cloud settings and responsive dark theme.
- Frontend static lint passed. Local Android-only behavior remains conditional;
  no APK/EXE build and no physical Android/iPhone testing in this cloud change.

Live deployment: guest placeholder and API restrictions checked read-only.
Real Telegram authorization/code exchange must be completed by the owner.
BotFather Allowed URLs were corrected by the owner; Telegram authorization page
now opens successfully. Saving/uploading Client Secret alone does not prove the
entire login/code exchange works; owner confirmation remains required.

Mobile login: first-party help page, same-tab redirect, no popup/iframe dependency.
Unit tests cover PKCE, callback URI, secure HttpOnly flow cookie and cross-site
start rejection. Read-only mobile browser smoke: tests/mobile-login.cjs (manual,
uses the live Telegram page, never authenticates a person or mutates cafe data).
It is not run in CI and does not replace real iPhone/Android device verification.
Published-flow smoke passed in Android Chrome and iPhone WebKit browser
emulation: same tab, no popup, secure flow cookie present, Telegram phone-number
fallback visible. The provider localized its page into Ukrainian during testing.
