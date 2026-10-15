# @valtu/wallet-kit

The Valtu Wallet SDK for your servers. It signs every API call with your API
key, retries safely, verifies webhooks, and converts amounts. TypeScript types
included, zero dependencies, Node 18.17 or newer.

Full guides: https://valtu.io/docs

## Install

```bash
npm install @valtu/wallet-kit
# or: pnpm add @valtu/wallet-kit · yarn add @valtu/wallet-kit
```

Also published as a file at https://valtu.io/docs/wallet-kit, with its SHA-256,
for builds that don't use the npm registry.

## Set up a key

Dashboard → **Developers → API keys → Create key**. The key pair is made in
your browser; download the key file (`valtu-<name>.json`) and keep it in
your secret manager. Valtu only stores the public key.

Prefer to make the key yourself? `npx valtu-wallet-kit keygen`, then paste
the public key in the dashboard.

```ts
import { Valtu } from "@valtu/wallet-kit";

const valtu = Valtu.fromKeyFile("./valtu-server.json");
// or: new Valtu({ privateKey: process.env.VALTU_PRIVATE_KEY! })
// or: Valtu.fromEnv()   (VALTU_PRIVATE_KEY or VALTU_KEY_FILE, optional VALTU_BASE_URL)
```

## Deposits: one wallet per customer

```ts
import { depositAddress } from "@valtu/wallet-kit";

const wallet = await valtu.wallets.forCustomer("cus_42");   // idempotent
const tron = depositAddress(wallet, "tron");                  // show this to the customer
const evm = depositAddress(wallet, "ethereum");               // same on bsc, polygon, base, lisk
```

## Payouts

```ts
const amount = await valtu.assets.toBaseUnits("USDT-TRC20", "25.50");   // "25500000"
const transfer = await valtu.transfers.create({
  walletId: payoutWallet.id,
  asset: "USDT-TRC20",
  amount,
  to: "TQ…",
  externalId: "payout_981",        // retries never send twice
});
// PENDING_APPROVAL (your team approves in the dashboard) or QUEUED → … → CONFIRMED
```

## Webhooks

```ts
import express from "express";
import { constructEvent, EventDeduper } from "@valtu/wallet-kit";

const seen = new EventDeduper();
app.post("/valtu/webhooks", express.raw({ type: "application/json" }), (req, res) => {
  let event;
  try {
    event = constructEvent(req.body, req.headers, { publicKey: process.env.VALTU_WEBHOOK_PUBLIC_KEY });
  } catch {
    return res.sendStatus(401);
  }
  res.sendStatus(200);
  if (!seen.first(event.id)) return;
  if (event.type === "deposit.confirmed") creditCustomer(event.data.walletId, event.data.asset, event.data.amount, event.data.depositId);
});
```

## Errors

Failed calls throw `ValtuError` with `status`, `code` (e.g. `NO_GAS`,
`INSUFFICIENT`, `POLICY_DENIED`, `DUPLICATE`) and `requestId`. GETs, and
POSTs carrying an `externalId`, are retried on network errors, 429 and 5xx.

## Reference

| | |
|---|---|
| `valtu.workspace() / balances() / networks()` | the key's workspace, totals per coin, network status |
| `wallets.create / forCustomer / get / balances / findByExternalId / list / iterate` | wallets |
| `transfers.create / createBatch / preview / get / findByExternalId / list / iterate / cancel / wait` | payouts |
| `deposits.get / list / iterate / findByTxHash / lookup` | incoming funds |
| `contracts.list / get / call` | calls to allowlisted smart contracts |
| `checkouts.create / get / list / iterate / cancel` | payment links with a hosted page |
| `webhooks.list / publicKey / test` | webhook endpoints and signing key |
| `assets.list / get / toBaseUnits / fromBaseUnits` | coins and decimals |
| `depositAddress(wallet, chain)` | a wallet's address on a network |
| `toBaseUnits / fromBaseUnits` | amount conversion without floating point |
| `constructEvent / verifyWebhook / verifyWebhookEd25519 / EventDeduper` | webhooks |
| `generateApiKey()` | a new key pair |

Keep the private key on your servers. Never ship it to a browser or a mobile app.
