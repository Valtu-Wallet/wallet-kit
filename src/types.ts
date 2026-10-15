// Shapes returned by the Valtu Wallet API (/v1). Amounts are integer
// strings in base units (wei, sun, lamports, satoshi, token units).

export type WalletType = "user" | "operational" | "treasury";

export interface WalletAddress {
  /** e.g. ADDRESS_FORMAT_ETHEREUM, ADDRESS_FORMAT_TRON, ADDRESS_FORMAT_SOLANA, ADDRESS_FORMAT_BITCOIN_MAINNET_P2WPKH */
  addressFormat: string;
  address: string;
  /** Network keys that use this address, e.g. ["ethereum", "bsc", "polygon", "base"]. */
  networks: string[];
}

export interface Wallet {
  id: string;
  name: string;
  type: WalletType;
  /** Your own id for the wallet (e.g. your customer id). Unique per workspace. */
  externalId: string | null;
  approvalGroupId: string | null;
  /** Set when the wallet is frozen in the dashboard. */
  disabledAt: string | null;
  createdAt: string;
  addresses: WalletAddress[];
}

export type DepositStatus = "PENDING" | "CONFIRMED" | "ORPHANED";

export interface Deposit {
  id: string;
  walletId: string;
  walletName: string | null;
  walletExternalId: string | null;
  chain: string;
  asset: string;
  decimals: number | null;
  amount: string;
  usdValue: number | null;
  /** Your wallet's address that received it. */
  address: string;
  from: string | null;
  txHash: string;
  /** Bitcoin output index; 0 elsewhere. */
  outputIndex: number;
  blockNumber: string;
  confirmations: number;
  status: DepositStatus;
  createdAt: string;
  confirmedAt: string | null;
}

export type TransferStatus =
  | "PENDING_APPROVAL"
  | "QUEUED"
  | "SIGNING"
  | "AWAITING_OFFICER"
  | "BROADCAST"
  | "CONFIRMED"
  | "FAILED"
  | "REJECTED"
  | "CANCELLED"
  | "NEEDS_REVIEW";

/** TRANSFER = a payout you asked for; CALL = a contract call; SWEEP and GAS are made by your automations and gas station. */
export type TransferKind = "TRANSFER" | "SWEEP" | "GAS" | "CALL";

export const FINAL_TRANSFER_STATUSES: readonly TransferStatus[] = ["CONFIRMED", "FAILED", "REJECTED", "CANCELLED"];

export interface Transfer {
  id: string;
  kind: TransferKind;
  walletId: string;
  walletName: string | null;
  chain: string;
  asset: string;
  decimals: number | null;
  amount: string;
  to: string;
  addressBookId: string | null;
  addressLabel: string | null;
  note: string | null;
  category: string | null;
  externalId: string | null;
  usdValue: number | null;
  status: TransferStatus;
  requiredApprovals: number;
  approvalGroupId: string | null;
  approvalGroupName: string | null;
  /** Which of your policies decided the approvals, if one did. */
  policyReason: string | null;
  approvalCount: number | null;
  proposedBy: string;
  proposerName: string | null;
  proposerAccountId: string | null;
  officerApproved: boolean | null;
  txHash: string | null;
  /** Network fee paid, in base units of `feeAsset` (the network's own coin), once confirmed. */
  networkFee: string | null;
  feeAsset: string | null;
  feeUsd: number | null;
  confirmations: number | null;
  failure: string | null;
  /** Why it is waiting, e.g. "waiting for gas…". */
  lastError: string | null;
  waitingSince: string | null;
  createdAt: string;
  updatedAt: string;
  confirmedAt: string | null;
  /** Contract calls only. */
  call: ContractCallInfo | null;
}

export interface ContractCallInfo {
  contractId: string;
  contractLabel: string | null;
  function: string;
  signature: string;
  selector: string;
  args: Array<{ name: string | null; type: string; value: unknown }>;
  data: string;
}

export type MessageType = "eip191" | "eip712" | "tip191" | "solana";
export type MessageRequestStatus = "PENDING_APPROVAL" | "SIGNED" | "REJECTED" | "EXPIRED" | "FAILED";

export interface SignMessageInput {
  /** An operational or treasury wallet. */
  walletId: string;
  /** eip191 (personal_sign), eip712 (typed data), tip191 (TRON signMessageV2), solana (off-chain message). */
  type: MessageType;
  /** Text, hex (with encoding "hex"), or for eip712 the typed data {types, primaryType, domain, message}. */
  message: string | { types: Record<string, Array<{ name: string; type: string }>>; primaryType: string; domain: Record<string, unknown>; message: Record<string, unknown> };
  encoding?: "utf8" | "hex";
  /** Idempotency: the same externalId returns the same request. */
  externalId?: string;
  note?: string;
}

export interface MessageRequest {
  id: string;
  walletId: string;
  type: MessageType;
  address: string;
  message: { text?: string; hex?: string; typedData?: unknown };
  status: MessageRequestStatus;
  approvals: { required: number; count: number; accountIds: string[] };
  /** Once SIGNED. EVM/TRON: 0x r||s||v (65 bytes, v 27/28). Solana: base58. */
  signature: string | null;
  signatureHex: string | null;
  error: string | null;
  externalId: string | null;
  note: string | null;
  createdAt: string;
  /** Your team has until then to approve (about 50 minutes). */
  expiresAt: string;
  decidedAt: string | null;
}

export interface Contract {
  id: string;
  chain: string;
  address: string;
  label: string;
  /** Allowed function signatures. */
  functions: string[];
  allFunctions: boolean;
  createdAt: string;
}

export interface ContractCallInput {
  walletId: string;
  contractId: string;
  /** Function name (or full signature if overloaded) with `args`… */
  function?: string;
  /** Integers as decimal strings, addresses and bytes as 0x-hex, tuples as arrays. */
  args?: unknown[];
  /** …or raw calldata. */
  data?: string;
  /** Native coin sent with the call, base units. Default "0". */
  value?: string;
  note?: string;
  externalId?: string;
  category?: string;
}

export interface Asset {
  /** Asset id used everywhere in the API, e.g. "USDT-TRC20", "ETH", "USDC-BASE". */
  asset: string;
  chain: string;
  network: "mainnet" | "testnet";
  addressFormat: string;
  decimals: number;
  /** Token contract (or mint); null for a network's own coin. */
  contract: string | null;
  /** Set when Valtu is closing this coin or its network: stop taking deposits before then. */
  closesAt: string | null;
}

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  environment: "test" | "live";
  status: "PENDING_REVIEW" | "ACTIVATING" | "ACTIVE" | "SUSPENDED" | "REJECTED";
  createdAt: string;
  activatedAt: string | null;
}

export interface Page<T> {
  items: T[];
  /** Pass as `cursor` to get the next page; null on the last page. */
  nextCursor: string | null;
}

export interface CreateWalletInput {
  name: string;
  type: WalletType;
  /** Makes the call idempotent: the same externalId returns the existing wallet. */
  externalId?: string;
}

export interface ListWalletsQuery {
  type?: WalletType;
  externalId?: string;
  /** Name, external id, wallet id or address. */
  q?: string;
  cursor?: string;
  limit?: number;
}

export interface CreateTransferInput {
  walletId: string;
  asset: string;
  /** Integer string in base units. Use `toBaseUnits()` to convert "25.5". */
  amount: string;
  /** Destination address, or `addressBookId` for a saved address. */
  to?: string;
  addressBookId?: string;
  note?: string;
  category?: string;
  /** Your payout id. Retries with the same id return the same transfer. Strongly recommended. */
  externalId?: string;
}

export interface ListTransfersQuery {
  /** One status or several: "QUEUED,SIGNING,BROADCAST" or an array. */
  status?: TransferStatus | TransferStatus[] | string;
  kind?: TransferKind | TransferKind[] | string;
  walletId?: string;
  externalId?: string;
  category?: string;
  asset?: string;
  /** ISO timestamps. */
  after?: string;
  before?: string;
  q?: string;
  cursor?: string;
  limit?: number;
}

export interface ListCheckoutsQuery {
  status?: CheckoutStatus | CheckoutStatus[] | string;
  externalId?: string;
  cursor?: string;
  limit?: number;
}

export interface ListDepositsQuery {
  status?: DepositStatus | DepositStatus[] | string;
  /** Exact transaction hash. */
  txHash?: string;
  walletId?: string;
  asset?: string;
  after?: string;
  before?: string;
  q?: string;
  cursor?: string;
  limit?: number;
}

export interface WalletBalance {
  asset: string;
  chain: string;
  address: string;
  decimals: number;
  /** On-chain balance, base units. Null when the network couldn't be read (see `error`). */
  balance: string | null;
  /** Reserved by payouts that haven't been sent yet. */
  onHold: string;
  /** balance − onHold: what a new payout can use. */
  available: string | null;
  usd: number | null;
  closesAt: string | null;
  error?: string;
}

export interface WalletBalances {
  walletId: string;
  balances: WalletBalance[];
  /** Null when a non-zero holding has no USD price. */
  totalUsd: number | null;
}

export interface BalanceSummary {
  asset: string;
  chain: string;
  decimals: number;
  usdPrice: number | null;
  /** Held in treasury and operational wallets. */
  held: { balance: string; usd: number | null; wallets: number } | null;
  /** Confirmed in user wallets and not swept yet. */
  awaitingSweep: { amount: string; usd: number | null; wallets: number } | null;
  closesAt: string | null;
}

export interface Network {
  chain: string;
  name: string;
  nativeAsset: string | null;
  status: "operational" | "degraded" | "down" | "unknown";
  /** Deposits are being watched. */
  deposits: boolean;
  /** Payouts can be sent. */
  sends: boolean;
  closing: { closesAt: string; notice: string | null } | null;
  typicalConfirmSeconds: number | null;
  typicalFeeUsd: number | null;
}

export interface FeeQuote {
  /** The network's own coin, which pays the fee. */
  asset: string;
  symbol: string;
  decimals: number;
  fee: string;
  usd: number | null;
  payer: "wallet" | "gas_station";
  ok: boolean;
  code: "NO_GAS" | "INSUFFICIENT_FOR_FEE" | null;
  message: string | null;
  /** Sending the network's own coin: the most that can be sent with the fee paid. */
  maxSendable?: string;
}

export interface TransferPreview {
  /** ALLOW: no approval needed · REQUIRE_APPROVAL / DEFAULT: approvals needed · DENY: a policy blocks it. */
  outcome: "ALLOW" | "REQUIRE_APPROVAL" | "DEFAULT" | "DENY";
  reason: string | null;
  approvals: number;
  groupName: string | null;
  othersNeeded?: number;
  usdValue: number | null;
  fee: FeeQuote | null;
}

export type BatchItemResult =
  | { index: number; externalId: string; ok: true; transfer: Transfer }
  | { index: number; externalId?: string; ok: false; error: { status: number; code: string; message: string } };

export interface BatchResult {
  results: BatchItemResult[];
  created: number;
  failed: number;
}

export type DepositLookupResult =
  | { status: "found"; deposits: Deposit[] }
  | { status: "not_found"; message: string }
  | { status: "pending"; block: string; message: string }
  | { status: "rescanning"; block: string; rescanId: string; message: string };

export interface WebhookEndpoint {
  id: string;
  url: string;
  description: string | null;
  events: string[];
  createdAt: string;
  pausedAt: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  /** Counted up to 10,000. */
  pending: number;
  /** Counted up to 10,000. */
  failed: number;
  /** At least 10,000 pending (the count stops there). */
  pendingCapped: boolean;
  /** At least 10,000 failed (the count stops there). */
  failedCapped: boolean;
}

export interface WebhookPublicKey {
  algorithm: "Ed25519";
  /** base64url raw key, for constructEvent({ publicKey }). */
  publicKey: string;
  pem: string;
}

export type CheckoutStatus = "OPEN" | "PROCESSING" | "COMPLETED" | "UNDERPAID" | "EXPIRED" | "CANCELLED";

export interface Checkout {
  id: string;
  /** The hosted payment page: send your customer here. */
  url: string;
  status: CheckoutStatus;
  /** USD, 2 decimals. */
  amount: string;
  currency: "USD";
  assets: string[];
  description: string | null;
  externalId: string | null;
  metadata: Record<string, unknown> | null;
  successUrl: string | null;
  cancelUrl: string | null;
  walletId: string;
  /** Set once the payer (or a single-coin checkout) picks a coin. */
  quote: { asset: string; chain: string; amount: string; decimals: number; address: string; expiresAt: string } | null;
  received: string;
  pending: string;
  depositIds: string[];
  paidLate: boolean;
  expiresAt: string;
  completedAt: string | null;
  createdAt: string;
}

export interface CreateCheckoutInput {
  /** USD with at most 2 decimals, e.g. "25.00". */
  amount: string | number;
  currency?: "USD";
  /** Asset ids the payer may choose; default every USD stablecoin on your networks. */
  assets?: string[];
  description?: string;
  /** Your order id: the same id returns the same checkout. */
  externalId?: string;
  successUrl?: string;
  cancelUrl?: string;
  /** 300 to 604800; default 3600. */
  expiresInSeconds?: number;
  /** Up to 2 KB, returned in checkout.* events. */
  metadata?: Record<string, unknown>;
}

// ───────── webhook events ─────────

interface EventBase<T extends string, D> {
  /** Unique per event: de-duplicate on it (delivery is at least once). */
  id: string;
  type: T;
  workspaceId: string;
  createdAt: string;
  data: D;
}

export interface DepositEventData {
  depositId: string;
  walletId: string;
  asset: string;
  chain: string;
  amount: string;
  address: string;
  fromAddress: string | null;
  txHash: string;
  outputIndex: number;
  confirmations: number;
  status: DepositStatus;
}

export interface TransferEventData {
  transferId: string;
  /** Present on sweep.* and gas.* events. */
  kind?: TransferKind;
  walletId: string;
  externalId: string | null;
  asset: string;
  chain: string;
  amount: string;
  toAddress: string;
  status: TransferStatus;
  txHash: string | null;
  failure: string | null;
}

type Lower<S extends string> = Lowercase<S>;

export type DepositEvent = EventBase<`deposit.${Lower<DepositStatus>}`, DepositEventData>;
export type TransferEvent = EventBase<`transfer.${Lower<TransferStatus>}`, TransferEventData>;
export type SweepEvent = EventBase<`sweep.${Lower<TransferStatus>}`, TransferEventData>;
export type GasTopUpEvent = EventBase<`gas.${Lower<TransferStatus>}`, TransferEventData>;
export type GasLowEvent = EventBase<"gas.low", { chain: string; asset: string; walletId: string; address: string; balance: string; threshold: string }>;
export type GasBlockedEvent = EventBase<"gas.blocked", { chain: string; reason: string }>;
export type NetworkEvent = EventBase<
  "network.closing" | "network.paused" | "network.resumed",
  { chain: string; asset?: string; name: string; closesAt?: string | null; notice?: string | null }
>;
export type WorkspaceEvent = EventBase<"workspace.suspended" | "workspace.reactivated", { reason: string | null }>;
export type TestEvent = EventBase<"webhook.test", { message: string }>;
export type CheckoutEvent = EventBase<
  "checkout.payment_detected" | "checkout.completed" | "checkout.underpaid" | "checkout.expired" | "checkout.cancelled",
  {
    checkoutId: string; externalId: string | null; status: CheckoutStatus; amountUsd: string; asset: string | null; quotedAmount: string | null;
    received: string; depositIds: string[]; walletId: string; paidLate: boolean; metadata: Record<string, unknown> | null;
  }
>;

export type MessageEvent = EventBase<
  "message.pending_approval" | "message.signed" | "message.rejected" | "message.expired" | "message.failed",
  { id: string; externalId: string | null; walletId?: string; type?: MessageType; signature?: string; error?: string | null }
>;

export type WebhookEvent =
  | DepositEvent
  | TransferEvent
  | SweepEvent
  | GasTopUpEvent
  | GasLowEvent
  | GasBlockedEvent
  | NetworkEvent
  | WorkspaceEvent
  | CheckoutEvent
  | MessageEvent
  | TestEvent;
