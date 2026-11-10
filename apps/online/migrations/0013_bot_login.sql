-- Short-lived, single-use MiniCafe codes. No plaintext codes or Telegram tokens.
CREATE TABLE bot_login_codes (
  telegram_id TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL UNIQUE,
  expires INTEGER NOT NULL
);
CREATE INDEX bot_login_expiry ON bot_login_codes(expires);
