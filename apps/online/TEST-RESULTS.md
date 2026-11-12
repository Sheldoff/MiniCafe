# Telegram authentication validation — 2026-10-29

## Settings / staff scopes — 3.52 / online 0.19 — 12.11.2026

- Full Android checks.py without skips passed: 85cced61a42246578f33ffb14c4f9822,
  23 Java suites, API and Chrome/WebKit including theme, navigation and tablets.
- Final scoped-cash initial render and bundled icon license additionally verified
  with focused Chrome/WebKit scoped-client tests and original-signed APK rebuild.
- 21 Node/SQLite tests and full disposable-local-D1 API suite passed; scoped staff
  tests cover private queue/ledger filtering, cross-location write rejection,
  unchanged sessions on display-name update and session revocation on deletion.
- Settings UI verified in Chrome/WebKit: icons, ordering, neighboring toggles,
  last logout, appearance Back, no drawer close control/theme border, dynamic
  location options, full identity-row click and cosmetic labels. Screens inspected.
- Migration 0015 applied and Worker 18a837f8-c778-48e4-9d62-66167eccce2c deployed.
  Source/online GitHub checks passed; GET-only public/login/auth isolation smoke passed.
  No physical phone/real Telegram login or production test orders; Windows frozen.


## Online 0.8 / Android 3.40 — 01.11.2026

- Canonical guest cashier flow, full-height layout, visible list beside/below editor,
  blank-main swipes and reduced-motion toast handling shared with Android.
- Local Java server: closed-by-default public catalog, persistent three-digit drafts,
  atomic payment redemption, role/origin/size/rate protections. Rejected HTTP requests
  close unread-body connections so subsequent requests cannot be misparsed.
- Menu transfer removed from HostActivity. Online APK admin Server page invokes a
  scoped native bridge: live /api/me admin check, explicit confirmation, existing
  one-use menu capability, same local-store/menu-revision checks. No automatic sync.
- New Java guest domain/HTTP suites; shared guest browser suite also runs in full
  Android checks. Cloud WebView bridge tested with a mock; physical devices untested.
- Full checks.py without skips passed: work/tests/results/a86af92d14484341bf6d0d3febfacb77.
  Original signing certificate verified. Online unit/local API, Chrome/WebKit guest,
  viewport and mocked APK transfer checks passed. Online 0.8 deployed as
  f77427ab-2eb4-4784-95ce-8abad3fd755b; public GET 200 and protected /admin 302 verified.

## Online 0.7.2 — 01.11.2026

- Reproduced actual Chrome form approval failure: no-referrer policy causes
  Origin: null on POST. Same-origin policy restores form provenance and still
  suppresses referrers to external sites. Origin/CSRF validation is unchanged;
  explicit null-origin and cross-site requests remain rejected.
- Real Chrome and WebKit form submission against disposable local D1 now passes,
  including one-use APK redemption and session rights. Regression command:
  npm run test:app-login (after local migrations, seed-auth and dev server).
- APK 3.39 unchanged. Physical Android/real Telegram approval not tested here.

## Online 0.7.1 — 01.11.2026

- Fix Android-origin Chrome navigation rejection: allow top-level document
  navigations to app/start, reject subresources/frames, render a first-party
  continue page so Android's cross-site metadata does not carry into auth/start.
- Device proof, browser approval CSRF/origin and one-use session checks retained.
  Unit regression covers cross-site document vs iframe. APK 3.39 unchanged.

## Online 0.7 / Android 3.39 — 01.11.2026

- OnlineActivity authorizes via browser and redeems a private 256-bit device proof
  once over HTTPS. The browser keeps its own session; a new role-checked session
  is installed as a Secure/HttpOnly first-party WebView cookie. No token in URI.
- Unit/local D1 API: explicit CSRF approval, wrong origin/proof rejection, expiry,
  one-use redemption, independent browser session, admin/bar access, phone grant
  continuity, revoked access and logout. Telegram JWT validation is unchanged.
- Chrome/WebKit: native JSON/PDF save handoff simulated with a mock bridge; normal
  browser paths and local APK UI/API regressions retained. Android JSON file picker
  and original-signed APK compile/verification passed; physical device flow untested.
- Full checks.py without skips: work/tests/results/4031f52ff5854487a5e9cdede1bb4f1c.
  Final native theme/error handling was additionally recompiled and APK-verified.
  No production restore tests, no Windows build or new APK signing key.

## Online 0.5.1 — 2026-10-31

- Highlighted required guest full-name field. Empty/single-part names blocked in
  UI and public-code API; whitespace normalized, length bounded to 100 characters.
- Guest name participates in cached-code identity and is transferred to the cashier.
  Existing nameless codes remain readable; guest menu/code responses expose no names.
- Unit, disposable-local-D1 validation and Chrome/WebKit guest-to-cashier tests.
  No physical-device or production-order test; no APK/Windows changes.

## Online 0.5 — 2026-10-30

- Public catalog projection excludes hidden products/private state; quantity,
  strict/estimated availability and authoritative prices validated server-side.
- Local D1: draft leaves orders/stock/statistics untouched; anonymous/bar lookup
  rejected; same-origin/CSRF and role gates; admin disable; one-use redemption,
  concurrent cashiers, payment retry idempotency, expiry unit checks. No public
  server restore or mutation tests.
- Chrome/WebKit: drink dialog, food quantities, code display, cashier import and
  payment, used-code rejection; full editor/draft preservation, save/close row,
  single name focus treatment, full-height drawer at phone/tablet/desktop sizes.
- Shared cashier/queues/report/PDF/editor/calculator workflows and responsive
  light/dark field checks exercised. Scrollbars visually hidden, scrolling kept.
- APK/Windows sources unchanged. No physical Android/iPhone verification claimed.

## Online 0.4.3 — 2026-10-30

- Screenshot identified Android Chrome's native bottom chin, outside the page DOM.
  The canonical admin viewport lacked viewport-fit=cover (guest/login already had it).
  Online builder now opts admin into edge-to-edge without changing APK assets.
- Drawer/overlay backgrounds still reach viewport bottom; controls and bounded
  content reserve the safe bottom inset. Prefer the maximum inset to avoid dynamic
  padding relayout during browser toolbar movement; retain Safari fallback.
- Chrome/WebKit regressions cover viewport opt-in, simulated 34px safe inset,
  full-height layers and protected drawer controls, plus existing responsive checks.
  Native Android Chrome chin cannot be verified by desktop browser emulation;
  physical device confirmation remains necessary.

## Online 0.4.2 — 2026-10-30

- Guest landing footer: replace the fixed 70svh content minimum with a flex column
  filling the dynamic viewport. Main grows, header/footer retain their intrinsic
  sizes, and long content can extend the document without overlap.
- Chrome/WebKit measured footer against body/viewport at 390×844, 820×1180,
  1440×1080 and 844×390; no empty area below footer or horizontal overflow.
- This fixes the guest page, which has its own layout, separately from admin UI.

## Online 0.4.1 — 2026-10-30

- Chrome/WebKit viewport regression at 390/820/1280: menu reaches viewport bottom,
  scrollbar hidden without disabling scroll, horizontal gestures on blank cashier
  surface work both ways, product search/actions stay fixed while the list scrolls.
- First-load layout waits for main to become visible and uses layout offsets rather
  than animated rectangles. Product editor remains independently scrollable.
- Server account name and role share a row. Responsive light/dark field checks pass.
- Online-only UI patch; APK/Windows and user data unchanged. No physical-device test.

## Online 0.4 — 2026-10-30

- Bot request unit tests mock Telegram: secret header, private identity, duplicate
  update, consent-bound contact, no auto-grant, CSRF, role escalation rejection,
  approve/reject, stale decision and renewed request. No test messages sent to users.
- Browser UI Chrome/WebKit: compact staff controls, safe profile/details, role
  acceptance, rejection, empty request hiding, account heading and removed duplicate
  buttons. Viewport fills available space; reduced-motion toast clears and never
  intercepts touches. Phone/tablet/desktop light/dark field layouts checked.
- Real Java Android core → local web D1 → Java core → web backup round trip:
  photos, mixed payments, historical request IDs containing dots, partial issue,
  sessions, expenses and preserved source counters. No production restore tests.
- Chrome/WebKit: JSON download and confirmed file restore; oversized old menu
  photo resized in browser. Cafe records/images exported from one DB snapshot.
- Simulated signed Telegram OAuth callback returns to the APK transfer page;
  replay rejected and external return URLs ignored. Normal site has no transfer link.
- APK/Windows executables were not rebuilt in this online-only change. No physical
  iPhone/Android test claimed. The existing APK 3.37 remains compatible.

## Android 3.37 / online 0.3

- Strict stock rejects excessive quantities, duplicate lines exceeding stock and
  restoring cancelled lines beyond stock. Estimated stock can become negative.
- Chrome/WebKit: two successive receipts with blank optional guest; strict zero
  tile disabled; estimate checkbox saved and retained in editor drafts; negative
  count remains available. Fixed invalid request IDs on the second cloud receipt.
- Menu transfer: menu/photo export/import, fresh product IDs, unchanged historical
  orders/sessions/expenses, invalid payload rollback, direction checks, one-use
  capability replay/race rejection. Only local disposable D1 was mutated.
- Staff page: add by phone, edit role, revoke and delete; late async writes cannot
  navigate users back to the staff page after they leave.
- Chrome/WebKit field/layout checks: 390/820/1280 px, light/dark, cashier, editor,
  calculator, reports, server, staff and transfer. Screenshots inspected visually.
- Android Java tests cover strict quantities, atomic failure, estimates and
  menu-only export/import preserving history. APK uses the original signing key.
- No physical phone transfer was performed; Telegram consent still requires
  the owner's account. The Windows executable remains frozen.

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
- Frontend static lint passed. No physical Android/iPhone testing; no EXE build.

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

## Online 0.6 / Android 3.38 — 01.11.2026
Тризначні коди, список неоплачених чернеток, лічильники порцій у drawer, список товарів поруч з редактором. Android має кнопку Онлайн, яка відкриває /admin системним браузером: це не вбудований WebView-вхід. Локальна база не синхронізується автоматично. Фізичні пристрої не тестувалися.

Повний Android-прогін checks.py без пропусків пройшов: work/tests/results/6ba7ffedda7040249f39e463dfed299e. Підпис APK відповідає оригінальному сертифікату.

