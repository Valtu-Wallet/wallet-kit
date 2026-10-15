// Verify that Valtu's signing enclave is the published image, without trusting Valtu.
//
// GET /v1/attestation?nonce=<your random hex> returns AWS Nitro attestation
// documents: COSE_Sign1 (ES384) signed by a certificate that chains up to the
// AWS Nitro Enclaves root. Each carries the image measurements (PCR0/1/2),
// your nonce (so it was made just now, for you) and the enclave's statement of
// the public keys it holds. Compare PCR0 with the published release
// measurements, and the keys with the published anchors.
//
//   const nonce = randomBytes(32).toString("hex");
//   const { attestations } = await valtu.attestation(nonce);
//   const ok = verifyAttestation(attestations[0].document, { nonce, expectedPcr0: PUBLISHED_PCR0 });
import { createHash, verify as cryptoVerify, X509Certificate } from "node:crypto";

/**
 * SHA-256 fingerprint of the AWS Nitro Enclaves root certificate (G1), as AWS
 * publishes it: https://docs.aws.amazon.com/enclaves/latest/user/verify-root.html
 */
export const AWS_NITRO_ROOT_SHA256 = "641a0321a3e244efe456463195d606317ed7cdcc3c1756e09893f3c68f79bb5b";

export interface AttestationStatement {
  v: number;
  service: string;
  role: string;
  /** Public keys this image holds: compare with the published anchors. */
  keys: Record<string, string>;
}

export interface VerifiedAttestation {
  moduleId: string;
  /** Milliseconds since the epoch, as stamped by the Nitro hypervisor. */
  timestamp: number;
  /** PCR index → hex. 0: the enclave image, 1: kernel and boot, 2: application. */
  pcrs: Record<number, string>;
  statement: AttestationStatement | null;
}

export class AttestationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AttestationError";
  }
}

export interface VerifyAttestationOptions {
  /** The nonce you sent (hex). Required: without it a captured document could be replayed. */
  nonce: string;
  /** The published PCR0 (hex) of the release you expect. */
  expectedPcr0?: string;
  /** Check certificate validity at this time. Default: now. */
  at?: Date;
  /** Root fingerprint to trust. Default: AWS's. Only tests change it. */
  rootSha256?: string;
}

/** Verify one attestation document (base64 or hex). Throws AttestationError when anything doesn't hold. */
export function verifyAttestation(document: string, opts: VerifyAttestationOptions): VerifiedAttestation {
  const bytes = /^[0-9a-f]+$/i.test(document) && document.length % 2 === 0 ? Buffer.from(document, "hex") : Buffer.from(document, "base64");
  let cose = decode(bytes);
  if (cose instanceof Tagged) cose = cose.value;
  if (!Array.isArray(cose) || cose.length !== 4) throw new AttestationError("not a COSE_Sign1 document");
  const [protectedHeader, , payload, signature] = cose as [Buffer, unknown, Buffer, Buffer];
  if (!Buffer.isBuffer(protectedHeader) || !Buffer.isBuffer(payload) || !Buffer.isBuffer(signature)) throw new AttestationError("malformed COSE_Sign1");
  const alg = (decode(protectedHeader) as Map<unknown, unknown>).get(1);
  if (alg !== -35) throw new AttestationError("unexpected signature algorithm (want ES384)");

  const doc = decode(payload) as Map<string, unknown>;
  if (!(doc instanceof Map)) throw new AttestationError("malformed attestation payload");
  const field = <T>(k: string) => doc.get(k) as T;

  // Certificate chain: cabundle[0] is the root, then intermediates, then the document's certificate.
  const bundle = field<Buffer[]>("cabundle");
  const leafDer = field<Buffer>("certificate");
  if (!Array.isArray(bundle) || !bundle.length || !Buffer.isBuffer(leafDer)) throw new AttestationError("missing certificates");
  const chain = [...bundle, leafDer].map((der) => new X509Certificate(der));
  const rootSha = createHash("sha256").update(bundle[0]!).digest("hex");
  if (rootSha !== (opts.rootSha256 ?? AWS_NITRO_ROOT_SHA256).toLowerCase()) throw new AttestationError("the chain doesn't start at the AWS Nitro Enclaves root");
  const at = opts.at ?? new Date();
  for (let i = 0; i < chain.length; i++) {
    const c = chain[i]!;
    if (new Date(c.validFrom) > at || new Date(c.validTo) < at) throw new AttestationError(`certificate ${i} is not valid at ${at.toISOString()}`);
    const issuer = i === 0 ? c : chain[i - 1]!;
    if (!c.verify(issuer.publicKey)) throw new AttestationError(`certificate ${i} isn't signed by its issuer`);
  }

  // The document's signature: COSE Sig_structure ["Signature1", protected, external_aad, payload].
  const toBeSigned = encodeSigStructure(protectedHeader, payload);
  const ok = cryptoVerify("sha384", toBeSigned, { key: chain[chain.length - 1]!.publicKey, dsaEncoding: "ieee-p1363" }, signature);
  if (!ok) throw new AttestationError("signature invalid");

  const nonce = field<Buffer | null>("nonce");
  if (!Buffer.isBuffer(nonce) || nonce.toString("hex") !== opts.nonce.replace(/^0x/, "").toLowerCase()) throw new AttestationError("nonce doesn't match: not made for this request");

  const pcrMap = field<Map<number, Buffer>>("pcrs");
  const pcrs: Record<number, string> = {};
  for (const [k, v] of pcrMap ?? []) pcrs[k] = Buffer.from(v).toString("hex");
  if (opts.expectedPcr0 && pcrs[0] !== opts.expectedPcr0.toLowerCase()) throw new AttestationError(`PCR0 ${pcrs[0]} isn't the expected release`);

  const userData = field<Buffer | null>("user_data");
  let statement: AttestationStatement | null = null;
  if (Buffer.isBuffer(userData)) {
    try {
      statement = JSON.parse(userData.toString("utf8")) as AttestationStatement;
    } catch {
      throw new AttestationError("user_data is not the enclave's statement");
    }
  }
  return { moduleId: String(field("module_id")), timestamp: Number(field("timestamp")), pcrs, statement };
}

// ───── minimal CBOR (RFC 8949): what attestation documents use ─────

class Tagged {
  readonly tag: number;
  readonly value: unknown;
  constructor(tag: number, value: unknown) {
    this.tag = tag;
    this.value = value;
  }
}

function decode(buf: Buffer): unknown {
  let i = 0;
  const len = (info: number): number => {
    if (info < 24) return info;
    if (info === 24) return buf[i++]!;
    if (info === 25) return (i += 2), buf.readUInt16BE(i - 2);
    if (info === 26) return (i += 4), buf.readUInt32BE(i - 4);
    if (info === 27) {
      const v = buf.readBigUInt64BE(i);
      i += 8;
      if (v > BigInt(Number.MAX_SAFE_INTEGER)) throw new AttestationError("CBOR integer too large");
      return Number(v);
    }
    throw new AttestationError("unsupported CBOR length");
  };
  const item = (): unknown => {
    if (i >= buf.length) throw new AttestationError("truncated CBOR");
    const b = buf[i++]!;
    const major = b >> 5, info = b & 31;
    if (info === 31 && major >= 2 && major <= 5) {
      // Indefinite length (AWS encodes the attestation payload as an indefinite-length map): items until the 0xff break.
      const items: unknown[] = [];
      while (buf[i] !== 0xff) {
        if (i >= buf.length) throw new AttestationError("truncated CBOR");
        items.push(item());
      }
      i++;
      if (major === 2) return Buffer.concat(items as Buffer[]);
      if (major === 3) return (items as string[]).join("");
      if (major === 4) return items;
      const m = new Map<unknown, unknown>();
      for (let k = 0; k + 1 < items.length; k += 2) m.set(items[k], items[k + 1]);
      return m;
    }
    switch (major) {
      case 0: return len(info);
      case 1: return -1 - len(info);
      case 2: { const n = len(info); const v = buf.subarray(i, i + n); i += n; return Buffer.from(v); }
      case 3: { const n = len(info); const v = buf.subarray(i, i + n).toString("utf8"); i += n; return v; }
      case 4: { const n = len(info); const a: unknown[] = []; for (let k = 0; k < n; k++) a.push(item()); return a; }
      case 5: { const n = len(info); const m = new Map<unknown, unknown>(); for (let k = 0; k < n; k++) { const key = item(); m.set(key, item()); } return m; }
      case 6: return new Tagged(len(info), item());
      case 7: return info === 20 ? false : info === 21 ? true : info === 22 ? null : (() => { throw new AttestationError("unsupported CBOR simple value"); })();
      default: throw new AttestationError("bad CBOR");
    }
  };
  const v = item();
  if (i !== buf.length) throw new AttestationError("trailing bytes after CBOR");
  return v;
}

function head(major: number, n: number): Buffer {
  if (n < 24) return Buffer.from([(major << 5) | n]);
  if (n < 256) return Buffer.from([(major << 5) | 24, n]);
  if (n < 65536) return Buffer.from([(major << 5) | 25, n >> 8, n & 255]);
  const b = Buffer.alloc(5);
  b[0] = (major << 5) | 26;
  b.writeUInt32BE(n, 1);
  return b;
}

function encodeSigStructure(protectedHeader: Buffer, payload: Buffer): Buffer {
  const text = Buffer.from("Signature1");
  return Buffer.concat([
    head(4, 4),
    head(3, text.length), text,
    head(2, protectedHeader.length), protectedHeader,
    head(2, 0),
    head(2, payload.length), payload,
  ]);
}
