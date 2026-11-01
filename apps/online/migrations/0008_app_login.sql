CREATE TABLE app_links(challenge TEXT PRIMARY KEY,source_hash TEXT NOT NULL,expires INTEGER NOT NULL);
CREATE INDEX app_links_expiry ON app_links(expires);
