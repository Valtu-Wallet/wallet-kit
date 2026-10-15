// Request signing: every call carries an ECDSA P-256 signature over
//   METHOD \n path?query \n timestampMs \n nonce \n hex(sha256(body))
// sent as X-Stamp, with X-Valtu-Timestamp and a single-use X-Valtu-Nonce.
// Valtu stores only your public key, so it can't forge requests, and nobody
// in between can change or replay them.
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, sign, type KeyObject } from "node:crypto";

export function canonicalRequest(method: string, pathAndQuery: string, timestampMs: string, nonce: string, body: string): string {
  return [method.toUpperCase(), pathAndQuery, timestampMs, nonce, createHash("sha256").update(body).digest("hex")].join("\n");
}

export class RequestSigner {
  private readonly key: KeyObject;
  /** Compressed public key (hex), as shown next to the key in the dashboard. */
  readonly publicKey: string;

  constructor(privateKeyHex: string) {
    this.key = privateKeyFromHex(privateKeyHex);
    this.publicKey = compressedPublicKey(this.key);
  }

  /** Headers for one request. Call once per attempt: nonces are single-use. */
  headers(method: string, pathAndQuery: string, body: string): Record<string, string> {
    const timestamp = String(Date.now());
    const nonce = randomBytes(18).toString("base64url");
    const signature = sign("sha256", Buffer.from(canonicalRequest(method, pathAndQuery, timestamp, nonce, body)), this.key).toString("hex");
    const stamp = Buffer.from(JSON.stringify({ publicKey: this.publicKey, scheme: "SIGNATURE_SCHEME_P256", signature })).toString("base64url");
    return { "x-valtu-timestamp": timestamp, "x-valtu-nonce": nonce, "x-stamp": stamp };
  }
}

/** A new API key pair. Register the public key in the dashboard; keep the private key in your secret manager. */
export function generateApiKey(): { privateKey: string; publicKey: string } {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  return { privateKey: Buffer.from(privateKey.export({ format: "jwk" }).d!, "base64url").toString("hex"), publicKey: compressedPublicKey(privateKey) };
}

function privateKeyFromHex(hex: string): KeyObject {
  const d = Buffer.from(hex.trim().replace(/^0x/, ""), "hex");
  if (d.length !== 32) throw new Error("the API private key must be 32 bytes (64 hex characters)");
  const der = Buffer.concat([Buffer.from("30310201010420", "hex"), d, Buffer.from("a00a06082a8648ce3d030107", "hex")]);
  return createPrivateKey({ key: der, format: "der", type: "sec1" });
}

function compressedPublicKey(key: KeyObject): string {
  const jwk = createPublicKey(key).export({ format: "jwk" });
  const x = Buffer.from(jwk.x!, "base64url");
  const y = Buffer.from(jwk.y!, "base64url");
  return Buffer.concat([Buffer.from([(y[y.length - 1]! & 1) === 1 ? 0x03 : 0x02]), x]).toString("hex");
}
