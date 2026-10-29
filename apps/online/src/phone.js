// UI input requires country code; do not guess countries or accept extensions.
export function normalizePhone(value, provider = false) {
  if (typeof value !== "string" || value.length > 40) return null;
  let phone = value.trim().replace(/[\s().-]/g, "");
  if (phone.startsWith("00")) phone = "+" + phone.slice(2);
  if (provider && /^\d+$/.test(phone)) phone = "+" + phone;
  return /^\+[1-9]\d{7,14}$/.test(phone) ? phone : null;
}
export async function claimPhone(db, payload, id) {
  if (payload.phone_number_verified !== true) return null;
  const phone = normalizePhone(payload.phone_number, true);
  if (!phone) return null;
  // First verified account claims the invitation. A recycled number cannot
  // silently transfer this grant to another Telegram account later.
  const row = await db
    .prepare(
      `UPDATE staff_phone SET claimed_id=?
    WHERE phone=? AND enabled=1 AND (claimed_id IS NULL OR claimed_id=?)
    RETURNING role,phone`,
    )
    .bind(id, phone, id)
    .first();
  return row || null;
}
