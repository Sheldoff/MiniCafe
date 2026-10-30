UPDATE public_settings SET published=1,accepting=1,revision=revision+1 WHERE id=1;
CREATE TABLE guest_codes (code_hash TEXT PRIMARY KEY, data TEXT NOT NULL, expires INTEGER NOT NULL, used_request TEXT);
CREATE INDEX guest_codes_expiry ON guest_codes(expires);
