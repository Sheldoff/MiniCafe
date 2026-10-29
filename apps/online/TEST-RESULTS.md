# Telegram authentication validation — 2026-10-29

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
Telegram currently responds `redirect_uri required` at the authorization page;
the callback is included in the URL. Verify BotFather Allowed URLs and retest.
Saving/uploading Client Secret alone does not prove the entire login works.
