CREATE TABLE staff_phone (
 phone TEXT PRIMARY KEY,
 role TEXT NOT NULL CHECK(role IN ('service','cash','bar','delivery')),
 enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
 claimed_id TEXT,
 updated TEXT NOT NULL
);
CREATE TABLE session_phone (
 token_hash TEXT PRIMARY KEY REFERENCES auth_sessions(token_hash) ON DELETE CASCADE,
 phone TEXT NOT NULL REFERENCES staff_phone(phone)
);
CREATE INDEX session_phone_number ON session_phone(phone);
