// @valtu/wallet-kit: the Valtu Wallet SDK for servers.
//
//   import { Valtu, constructEvent, depositAddress } from "@valtu/wallet-kit";
//   const valtu = Valtu.fromKeyFile("./valtu-server.json");
//   const wallet = await valtu.wallets.forCustomer("cus_42");
//   const tron = depositAddress(wallet, "tron");
export { Valtu, depositAddress, DEFAULT_BASE_URL, type ValtuOptions, type KeyFile } from "./client.ts";
export { ValtuError, WebhookVerificationError } from "./errors.ts";
export { toBaseUnits, fromBaseUnits } from "./amounts.ts";
export { generateApiKey, canonicalRequest } from "./signing.ts";
export { constructEvent, verifyWebhook, verifyWebhookEd25519, EventDeduper, SIGNATURE_HEADER, ED25519_SIGNATURE_HEADER, type VerifyOptions } from "./webhooks.ts";
export * from "./types.ts";
export { verifyAttestation, AttestationError, AWS_NITRO_ROOT_SHA256, type VerifiedAttestation, type AttestationStatement, type VerifyAttestationOptions } from "./attestation.ts";
