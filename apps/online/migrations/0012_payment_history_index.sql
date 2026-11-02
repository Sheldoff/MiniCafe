-- Read-only bank request history; existing payment records are preserved.
CREATE INDEX IF NOT EXISTS mono_payments_history ON mono_payments(created DESC, reference DESC);
