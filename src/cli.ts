#!/usr/bin/env node
// npx valtu-wallet-kit keygen
//   A new API key pair, for "Paste a public key" in the dashboard.
// npx valtu-wallet-kit webhooks listen --forward http://localhost:3000/webhooks [--since 2026-10-09T00:00:00Z]
//   Local development without a public URL: polls your workspace's events
//   (GET /v1/events, key from VALTU_PRIVATE_KEY or VALTU_KEY_FILE) and forwards
//   each one to your handler, signed like a real delivery but with LOCAL keys
//   printed at start. Configure your handler with those for local runs only.
import { createHmac, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { generateApiKey } from "./signing.ts";
import { Valtu } from "./client.ts";

const [cmd, sub] = process.argv.slice(2);
const flag = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};

if (cmd === "keygen") {
  const k = generateApiKey();
  process.stdout.write(
    `Public key (paste into Dashboard → Developers → API keys → Paste a public key):\n  ${k.publicKey}\n\n` +
      `Private key (put in your secret manager as VALTU_PRIVATE_KEY; never commit it):\n  ${k.privateKey}\n`,
  );
} else if (cmd === "webhooks" && sub === "listen") {
  void listen().catch((e) => {
    process.stderr.write(`${(e as Error).message}\n`);
    process.exitCode = 1;
  });
} else {
  process.stdout.write("usage:\n  valtu-wallet-kit keygen\n  valtu-wallet-kit webhooks listen --forward <url> [--since <ISO time>] [--type deposit.*]\n");
  process.exitCode = cmd ? 1 : 0;
}

async function listen() {
  const forward = flag("forward");
  if (!forward) throw new Error("--forward <url> is required, e.g. --forward http://localhost:3000/webhooks");
  const valtu = Valtu.fromEnv();
  // Local signing keys: deliveries verify in your handler exactly as production ones do.
  const secret = `whsec_local_${randomBytes(12).toString("hex")}`;
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const pub = publicKey.export({ format: "jwk" }).x!;
  process.stdout.write(
    `Forwarding events to ${forward}\n` +
      `  local webhook public key (VALTU_WEBHOOK_PUBLIC_KEY): ${pub}\n` +
      `  local endpoint secret: ${secret}\n` +
      `These keys exist only for this session; production deliveries use your workspace's keys.\n\n`,
  );
  let cursor: string | undefined;
  let after: string | undefined = flag("since") ?? new Date().toISOString();
  for (;;) {
    const page = await valtu.events.list({ cursor, after: cursor ? undefined : after, type: flag("type"), limit: 100 });
    for (const e of page.events) {
      const body = JSON.stringify(e);
      const t = Math.floor(Date.now() / 1000);
      const headers = {
        "content-type": "application/json",
        "x-valtu-signature": `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`,
        "x-valtu-signature-ed25519": `t=${t},v1=${sign(null, Buffer.from(`${t}.${body}`), privateKey).toString("base64url")}`,
        "x-valtu-event": e.type,
      };
      const started = Date.now();
      try {
        const res = await fetch(forward, { method: "POST", headers, body, signal: AbortSignal.timeout(10_000) });
        process.stdout.write(`${new Date().toISOString()}  ${e.type.padEnd(28)} ${e.id}  → ${res.status} (${Date.now() - started} ms)\n`);
      } catch (err) {
        process.stdout.write(`${new Date().toISOString()}  ${e.type.padEnd(28)} ${e.id}  → failed: ${(err as Error).message}\n`);
      }
    }
    // Keep the start time until there's a cursor, or an empty first poll would replay all history.
    if (page.nextCursor) {
      cursor = page.nextCursor;
      after = undefined;
    }
    if (!page.hasMore) await new Promise((r) => setTimeout(r, 2000));
  }
}
