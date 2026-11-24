/**
 * Waitlist for the product site (web/src/site): visitors leave an email while sign-up is closed; the operator reads
 * the list in Account → Waitlist. Joining never reveals whether an email was already on it.
 */
import { HTTPException } from "hono/http-exception";
import { db, nowIso } from "./db";
import { EMAIL_RE } from "./auth";

export type WaitlistEntry = { email: string; note: string; createdAt: string };

export const validateWaitlist = (body: { email?: unknown; note?: unknown }) => {
  if (typeof body.email !== "string" || body.email.length > 254 || !EMAIL_RE.test(body.email.trim())) throw new HTTPException(400, { message: "Enter a valid email" });
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 280) : "";
  return { email: body.email.trim().toLowerCase(), note };
};

export const joinWaitlist = (email: string, note: string): void => {
  db.prepare("INSERT INTO waitlist (email, note, created_at) VALUES (?, ?, ?) ON CONFLICT(email) DO UPDATE SET note = CASE WHEN excluded.note != '' THEN excluded.note ELSE waitlist.note END").run(email, note, nowIso());
};

export const listWaitlist = (): WaitlistEntry[] =>
  (db.prepare("SELECT email, note, created_at FROM waitlist ORDER BY created_at DESC").all() as { email: string; note: string; created_at: string }[])
    .map((r) => ({ email: r.email, note: r.note, createdAt: r.created_at }));

export const removeFromWaitlist = (email: string): boolean => db.prepare("DELETE FROM waitlist WHERE email = ?").run(email).changes > 0;
