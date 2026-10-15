// Webhook verification. Each delivery is signed twice over "<t>.<raw body>":
//   X-Valtu-Signature:         t=<unix s>,v1=<hex HMAC-SHA256(endpoint secret)>
//   X-Valtu-Signature-Ed25519: t=<unix s>,v1=<base64url Ed25519 signature>
// Check either one. The Ed25519 public key (dashboard → Webhooks) is not a
// secret, so it can live in plain config.
import { createHmac, createPublicKey, timingSafeEqual, verify as cryptoVerify } from "node:crypto";
import { WebhookVerificationError } from "./errors.ts";
import type { WebhookEvent } from "./types.ts";

export const SIGNATURE_HEADER = "x-valtu-signature";
export const ED25519_SIGNATURE_HEADER = "x-valtu-signature-ed25519";

type HeaderBag = Headers | Record<string, string | string[] | undefined>;

export interface VerifyOptions {
  /** Your workspace's Ed25519 webhook public key (base64url, or PEM). */
  publicKey?: string;
  /** The endpoint's signing secret (shown once when the endpoint was added). */
  secret?: string;
  /** Reject deliveries signed longer ago than this. Default 300 s. */
  toleranceSec?: number;
}

/**
 * Verify a delivery and return the parsed event. Pass the raw body exactly as
 * received (before any JSON parsing). Throws WebhookVerificationError.
 *
 *   const event = constructEvent(rawBody, req.headers, { publicKey: process.env.VALTU_WEBHOOK_PUBLIC_KEY });
 */
export function constructEvent(rawBody: string | Uint8Array, headers: HeaderBag, opts: VerifyOptions): WebhookEvent {
  if (!opts.publicKey && !opts.secret) throw new Error("give the webhook publicKey or the endpoint secret");
  const body = typeof rawBody === "string" ? rawBody : Buffer.from(rawBody).toString("utf8");
  const tolerance = opts.toleranceSec ?? 300;
  const ok =
    (opts.publicKey !== undefined && verifyWebhookEd25519(body, header(headers, ED25519_SIGNATURE_HEADER), opts.publicKey, tolerance)) ||
    (opts.secret !== undefined && verifyWebhook(body, header(headers, SIGNATURE_HEADER), opts.secret, tolerance));
  if (!ok) throw new WebhookVerificationError("webhook signature is missing, wrong or too old");
  let event: WebhookEvent;
  try {
    event = JSON.parse(body) as WebhookEvent;
  } catch {
    throw new WebhookVerificationError("webhook body is not JSON");
  }
  if (!event || typeof event.id !== "string" || typeof event.type !== "string") throw new WebhookVerificationError("webhook body is not a Valtu event");
  return event;
}

/** HMAC check of X-Valtu-Signature. Returns false rather than throwing. */
export function verifyWebhook(rawBody: string, signatureHeader: string | undefined, secret: string, toleranceSec = 300): boolean {
  const parts = parseHeader(signatureHeader);
  if (!parts || !fresh(parts.t, toleranceSec)) return false;
  const expected = Buffer.from(createHmac("sha256", secret).update(`${parts.t}.${rawBody}`).digest("hex"));
  const given = Buffer.from(parts.v1);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Ed25519 check of X-Valtu-Signature-Ed25519. Returns false rather than throwing. */
export function verifyWebhookEd25519(rawBody: string, signatureHeader: string | undefined, publicKey: string, toleranceSec = 300): boolean {
  const parts = parseHeader(signatureHeader);
  if (!parts || !fresh(parts.t, toleranceSec)) return false;
  try {
    const key = publicKey.includes("BEGIN")
      ? createPublicKey(publicKey)
      : createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: publicKey.trim() }, format: "jwk" });
    return cryptoVerify(null, Buffer.from(`${parts.t}.${rawBody}`), key, Buffer.from(parts.v1, "base64url"));
  } catch {
    return false;
  }
}

function parseHeader(h: string | undefined): { t: string; v1: string } | null {
  const parts = Object.fromEntries((h ?? "").split(",").map((p) => {
    const i = p.indexOf("=");
    return [p.slice(0, i).trim(), p.slice(i + 1).trim()];
  }));
  return parts.t && parts.v1 ? { t: parts.t, v1: parts.v1 } : null;
}

function fresh(t: string, toleranceSec: number): boolean {
  const n = Number(t);
  return Number.isFinite(n) && Math.abs(Date.now() / 1000 - n) <= toleranceSec;
}

function header(h: HeaderBag, name: string): string | undefined {
  if (typeof (h as Headers).get === "function") return (h as Headers).get(name) ?? undefined;
  const bag = h as Record<string, string | string[] | undefined>;
  const v = bag[name] ?? Object.entries(bag).find(([k]) => k.toLowerCase() === name)?.[1];
  return Array.isArray(v) ? v[0] : v;
}

/**
 * Remembers event ids it has seen (in memory, bounded) so a redelivery is
 * skipped. For more than one server process, de-duplicate in your database
 * instead (a unique index on the event id).
 */
export class EventDeduper {
  private readonly seen = new Set<string>();
  private readonly max: number;
  constructor(max = 10_000) {
    this.max = max;
  }
  /** True the first time an id is seen. */
  first(id: string): boolean {
    if (this.seen.has(id)) return false;
    this.seen.add(id);
    if (this.seen.size > this.max) this.seen.delete(this.seen.values().next().value!);
    return true;
  }
}
