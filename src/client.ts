// The Valtu Wallet API client. Server-side only: it holds your API private
// key. Calls are signed, retried safely, and typed.
import { readFileSync } from "node:fs";
import { toBaseUnits, fromBaseUnits } from "./amounts.ts";
import { ValtuError } from "./errors.ts";
import { RequestSigner } from "./signing.ts";
import {
  FINAL_TRANSFER_STATUSES,
  type Asset,
  type BalanceSummary,
  type BatchResult,
  type Checkout,
  type Contract,
  type ContractCallInput,
  type MessageRequest,
  type WebhookEvent,
  type MessageRequestStatus,
  type SignMessageInput,
  type CreateCheckoutInput,
  type ListCheckoutsQuery,
  type CreateTransferInput,
  type DepositLookupResult,
  type Network,
  type TransferPreview,
  type WalletBalances,
  type WebhookEndpoint,
  type WebhookPublicKey,
  type CreateWalletInput,
  type Deposit,
  type ListDepositsQuery,
  type ListTransfersQuery,
  type ListWalletsQuery,
  type Page,
  type Transfer,
  type TransferStatus,
  type Wallet,
  type Workspace,
} from "./types.ts";

export const DEFAULT_BASE_URL = "https://valtu.io";
const VERSION = "0.8.0";

export interface ValtuOptions {
  /** Your API private key (64 hex characters), from the key file the dashboard gave you. */
  privateKey: string;
  /** Default https://valtu.io */
  baseUrl?: string;
  /** Per attempt. Default 30 s. */
  timeoutMs?: number;
  /** Extra attempts for network errors, 429 and 5xx, on requests that are safe to repeat. Default 2. */
  maxRetries?: number;
  /** Custom fetch (proxies, tests). */
  fetch?: typeof fetch;
}

/** The JSON file the dashboard downloads when you create an API key. */
export interface KeyFile {
  workspaceId: string;
  apiKeyId: string;
  name: string;
  publicKey: string;
  privateKey: string;
}

type Query = Record<string, string | number | string[] | undefined | null>;

export class Valtu {
  readonly baseUrl: string;
  /** Your API key's public key (compressed hex), as listed in the dashboard. */
  readonly publicKey: string;
  readonly wallets: WalletsApi;
  readonly transfers: TransfersApi;
  readonly deposits: DepositsApi;
  readonly assets: AssetsApi;
  readonly webhooks: WebhooksApi;
  readonly checkouts: CheckoutsApi;
  readonly contracts: ContractsApi;
  readonly messages: MessagesApi;
  readonly events: EventsApi;
  private readonly signer: RequestSigner;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly fetchFn: typeof fetch;

  constructor(opts: ValtuOptions) {
    if (!opts?.privateKey) throw new Error("Valtu: privateKey is required");
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "").replace(/\/v1$/, "");
    this.signer = new RequestSigner(opts.privateKey);
    this.publicKey = this.signer.publicKey;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.maxRetries = Math.max(0, opts.maxRetries ?? 2);
    this.fetchFn = opts.fetch ?? globalThis.fetch;
    this.wallets = new WalletsApi(this);
    this.transfers = new TransfersApi(this);
    this.deposits = new DepositsApi(this);
    this.assets = new AssetsApi(this);
    this.webhooks = new WebhooksApi(this);
    this.checkouts = new CheckoutsApi(this);
    this.contracts = new ContractsApi(this);
    this.messages = new MessagesApi(this);
    this.events = new EventsApi(this);
  }

  /** From the key file the dashboard downloaded (`valtu-<name>.json`). */
  static fromKeyFile(path: string, opts: Omit<ValtuOptions, "privateKey"> = {}): Valtu {
    const file = JSON.parse(readFileSync(path, "utf8")) as Partial<KeyFile>;
    if (!file.privateKey) throw new Error(`${path} has no privateKey`);
    return new Valtu({ ...opts, privateKey: file.privateKey });
  }

  /** VALTU_PRIVATE_KEY (or VALTU_KEY_FILE) and optional VALTU_BASE_URL. */
  static fromEnv(env: Record<string, string | undefined> = process.env, opts: Omit<ValtuOptions, "privateKey"> = {}): Valtu {
    const get = (name: string) => env[`VALTU_${name}`];
    const baseUrl = opts.baseUrl ?? get("BASE_URL");
    const privateKey = get("PRIVATE_KEY"), keyFile = get("KEY_FILE");
    if (privateKey) return new Valtu({ ...opts, baseUrl, privateKey });
    if (keyFile) return Valtu.fromKeyFile(keyFile, { ...opts, baseUrl });
    throw new Error("set VALTU_PRIVATE_KEY or VALTU_KEY_FILE");
  }

  /** The workspace this key belongs to (environment test or live, status). */
  async workspace(): Promise<Workspace> {
    return (await this.request<{ workspace: Workspace }>("GET", "/v1/workspace")).workspace;
  }

  /** Workspace totals per coin: held in treasury/operational wallets and waiting in user wallets to be swept. */
  /**
   * AWS Nitro attestation of the signing enclave, made for `nonce` (8-64 random bytes, hex).
   * Check it with verifyAttestation(); don't take the statement on trust.
   */
  async attestation(nonce: string): Promise<{ nonce: string; format: string; attestations: Array<{ document: string; statement: unknown }> }> {
    return this.request("GET", "/v1/attestation", undefined, { query: { nonce } });
  }

  async balances(): Promise<BalanceSummary[]> {
    return (await this.request<{ balances: BalanceSummary[] }>("GET", "/v1/balances")).balances;
  }

  /** Each network's status, typical confirmation time and fee, and closing date if any. */
  async networks(): Promise<Network[]> {
    return (await this.request<{ networks: Network[] }>("GET", "/v1/networks")).networks;
  }

  /**
   * A signed call to any /v1 path. `retry` marks a POST as safe to repeat
   * (GETs always are). Each attempt gets a fresh timestamp and nonce.
   */
  async request<T>(method: "GET" | "POST", path: string, body?: object, opts: { query?: Query; retry?: boolean } = {}): Promise<T> {
    const pathAndQuery = path + queryString(opts.query);
    const raw = body === undefined ? "" : JSON.stringify(body);
    const retryable = method === "GET" || opts.retry === true;
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        const headers: Record<string, string> = { ...this.signer.headers(method, pathAndQuery, raw), accept: "application/json", "user-agent": `valtu-wallet-kit/${VERSION}` };
        if (body !== undefined) headers["content-type"] = "application/json";
        res = await this.fetchFn(this.baseUrl + pathAndQuery, { method, headers, body: body === undefined ? undefined : raw, signal: AbortSignal.timeout(this.timeoutMs) });
      } catch (e) {
        if (retryable && attempt < this.maxRetries) {
          await sleep(backoff(attempt));
          continue;
        }
        throw new ValtuError(0, "NETWORK_ERROR", `could not reach Valtu: ${(e as Error).message}`);
      }
      const text = await res.text();
      let json: any = {};
      try {
        json = text ? JSON.parse(text) : {};
      } catch {
        /* not JSON (a proxy's error page): handled below */
      }
      if (res.ok) return json as T;
      const transient = res.status === 429 || res.status === 502 || res.status === 503 || res.status === 504;
      if (transient && retryable && attempt < this.maxRetries) {
        const after = Number(res.headers.get("retry-after"));
        await sleep(Number.isFinite(after) && after > 0 ? Math.min(after, 30) * 1000 : backoff(attempt));
        continue;
      }
      throw new ValtuError(res.status, json.code ?? "HTTP_ERROR", json.message ?? `HTTP ${res.status}`, res.headers.get("x-request-id"));
    }
  }
}

class WalletsApi {
  private readonly c: Valtu;
  constructor(c: Valtu) {
    this.c = c;
  }

  /** Create a wallet. With `externalId` it's idempotent: the same id returns the existing wallet. */
  async create(input: CreateWalletInput): Promise<Wallet> {
    return (await this.c.request<{ wallet: Wallet }>("POST", "/v1/wallets", input, { retry: !!input.externalId })).wallet;
  }

  /** The `user` wallet for one of your customers, created on first use. */
  async forCustomer(customerId: string, name?: string): Promise<Wallet> {
    return this.create({ name: name ?? `Customer ${customerId}`, type: "user", externalId: customerId });
  }

  async get(id: string): Promise<Wallet> {
    return (await this.c.request<{ wallet: Wallet }>("GET", `/v1/wallets/${encodeURIComponent(id)}`)).wallet;
  }

  /** The wallet with this externalId, or null. */
  async findByExternalId(externalId: string): Promise<Wallet | null> {
    return (await this.list({ externalId, limit: 1 })).items[0] ?? null;
  }

  /** Live balances of every coin on every network the wallet has an address for (cached ~30 s). */
  async balances(id: string): Promise<WalletBalances> {
    return this.c.request<WalletBalances>("GET", `/v1/wallets/${encodeURIComponent(id)}/balances`);
  }

  async list(q: ListWalletsQuery = {}): Promise<Page<Wallet>> {
    const r = await this.c.request<{ wallets: Wallet[]; nextCursor: string | null }>("GET", "/v1/wallets", undefined, { query: q as Query });
    return { items: r.wallets, nextCursor: r.nextCursor ?? null };
  }

  /** Every wallet matching the query, page by page. */
  iterate(q: Omit<ListWalletsQuery, "cursor"> = {}): AsyncGenerator<Wallet> {
    return paginate((cursor) => this.list({ ...q, cursor }));
  }
}

class TransfersApi {
  private readonly c: Valtu;
  constructor(c: Valtu) {
    this.c = c;
  }

  /**
   * Ask for a payout. Your policies decide whether it needs approvals
   * (status PENDING_APPROVAL) or goes straight to signing (QUEUED).
   * With `externalId` a retry returns the same transfer and never sends twice.
   */
  async create(input: CreateTransferInput): Promise<Transfer> {
    return (await this.c.request<{ transfer: Transfer }>("POST", "/v1/transfers", input, { retry: !!input.externalId })).transfer;
  }

  async get(id: string): Promise<Transfer> {
    return (await this.c.request<{ transfer: Transfer }>("GET", `/v1/transfers/${encodeURIComponent(id)}`)).transfer;
  }

  /** What a payout would do, without creating it: network fee (NO_GAS, max sendable), USD value, policy outcome. */
  async preview(input: CreateTransferInput): Promise<TransferPreview> {
    return (await this.c.request<{ preview: TransferPreview }>("POST", "/v1/transfers/preview", input, { retry: true })).preview;
  }

  /**
   * Up to 100 payouts in one call, each with its own externalId. Not atomic:
   * check each result. Re-sending the same batch is safe.
   */
  async createBatch(inputs: Array<CreateTransferInput & { externalId: string }>): Promise<BatchResult> {
    if (inputs.some((t) => !t.externalId)) throw new Error("every transfer in a batch needs an externalId");
    return this.c.request<BatchResult>("POST", "/v1/transfers/batch", { transfers: inputs }, { retry: true });
  }

  /** The transfer you created with this externalId, or null. */
  async findByExternalId(externalId: string): Promise<Transfer | null> {
    return (await this.list({ externalId, limit: 1 })).items[0] ?? null;
  }

  /** Cancel before signing. API keys cancel their own transfers; admin keys any. */
  async cancel(id: string): Promise<Transfer> {
    return (await this.c.request<{ transfer: Transfer }>("POST", `/v1/transfers/${encodeURIComponent(id)}/cancel`, {})).transfer;
  }

  async list(q: ListTransfersQuery = {}): Promise<Page<Transfer>> {
    const r = await this.c.request<{ transfers: Transfer[]; nextCursor: string | null }>("GET", "/v1/transfers", undefined, { query: q as Query });
    return { items: r.transfers, nextCursor: r.nextCursor ?? null };
  }

  iterate(q: Omit<ListTransfersQuery, "cursor"> = {}): AsyncGenerator<Transfer> {
    return paginate((cursor) => this.list({ ...q, cursor }));
  }

  /**
   * Poll until the transfer reaches one of `until` (default: a final status).
   * Webhooks are the better way in production; this suits scripts and tests.
   */
  async wait(id: string, opts: { until?: readonly TransferStatus[]; timeoutMs?: number; intervalMs?: number } = {}): Promise<Transfer> {
    const until = opts.until ?? FINAL_TRANSFER_STATUSES;
    const deadline = Date.now() + (opts.timeoutMs ?? 10 * 60_000);
    for (;;) {
      const t = await this.get(id);
      if (until.includes(t.status)) return t;
      if (Date.now() > deadline) throw new ValtuError(0, "TIMEOUT", `transfer ${id} is still ${t.status}`);
      await sleep(opts.intervalMs ?? 5_000);
    }
  }
}

class DepositsApi {
  private readonly c: Valtu;
  constructor(c: Valtu) {
    this.c = c;
  }

  async get(id: string): Promise<Deposit> {
    return (await this.c.request<{ deposit: Deposit }>("GET", `/v1/deposits/${encodeURIComponent(id)}`)).deposit;
  }

  /** Deposits recorded from this transaction (one transaction can pay several of your addresses). */
  async findByTxHash(txHash: string): Promise<Deposit[]> {
    return (await this.list({ txHash, limit: 50 })).items;
  }

  /**
   * "I sent it, where is it?" Returns the deposits if recorded; otherwise asks
   * the network and, if needed, re-reads the transaction's block.
   */
  async lookup(chain: string, txHash: string): Promise<DepositLookupResult> {
    return this.c.request<DepositLookupResult>("POST", "/v1/deposits/lookup", { chain, txHash }, { retry: true });
  }

  async list(q: ListDepositsQuery = {}): Promise<Page<Deposit>> {
    const r = await this.c.request<{ deposits: Deposit[]; nextCursor: string | null }>("GET", "/v1/deposits", undefined, { query: q as Query });
    return { items: r.deposits, nextCursor: r.nextCursor ?? null };
  }

  iterate(q: Omit<ListDepositsQuery, "cursor"> = {}): AsyncGenerator<Deposit> {
    return paginate((cursor) => this.list({ ...q, cursor }));
  }
}

class AssetsApi {
  private readonly c: Valtu;
  private cache: { at: number; assets: Asset[] } | null = null;
  constructor(c: Valtu) {
    this.c = c;
  }

  /** Coins your workspace can use (its environment's networks). Cached for 5 minutes. */
  async list(opts: { fresh?: boolean } = {}): Promise<Asset[]> {
    if (!opts.fresh && this.cache && Date.now() - this.cache.at < 5 * 60_000) return this.cache.assets;
    const { assets } = await this.c.request<{ assets: Asset[] }>("GET", "/v1/assets");
    this.cache = { at: Date.now(), assets };
    return assets;
  }

  async get(asset: string): Promise<Asset> {
    const a = (await this.list()).find((x) => x.asset === asset) ?? (await this.list({ fresh: true })).find((x) => x.asset === asset);
    if (!a) throw new ValtuError(404, "UNSUPPORTED", `${asset} is not available in this workspace`);
    return a;
  }

  /** "25.5" USDT-TRC20 → "25500000", using the asset's decimals. */
  async toBaseUnits(asset: string, value: string | number): Promise<string> {
    return toBaseUnits(value, (await this.get(asset)).decimals);
  }

  /** "25500000" USDT-TRC20 → "25.5". */
  async fromBaseUnits(asset: string, amount: string | bigint): Promise<string> {
    return fromBaseUnits(amount, (await this.get(asset)).decimals);
  }
}

class CheckoutsApi {
  private readonly c: Valtu;
  constructor(c: Valtu) {
    this.c = c;
  }

  /** A payment link for a USD amount. Send your customer to `checkout.url`. */
  async create(input: CreateCheckoutInput): Promise<Checkout> {
    return (await this.c.request<{ checkout: Checkout }>("POST", "/v1/checkouts", input, { retry: !!input.externalId })).checkout;
  }

  async get(id: string): Promise<Checkout> {
    return (await this.c.request<{ checkout: Checkout }>("GET", `/v1/checkouts/${encodeURIComponent(id)}`)).checkout;
  }

  async list(q: ListCheckoutsQuery = {}): Promise<Page<Checkout>> {
    const r = await this.c.request<{ checkouts: Checkout[]; nextCursor: string | null }>("GET", "/v1/checkouts", undefined, { query: q as Query });
    return { items: r.checkouts, nextCursor: r.nextCursor ?? null };
  }

  iterate(q: Omit<ListCheckoutsQuery, "cursor"> = {}): AsyncGenerator<Checkout> {
    return paginate((cursor) => this.list({ ...q, cursor }));
  }

  /** Only an open checkout with no payment. */
  async cancel(id: string): Promise<Checkout> {
    return (await this.c.request<{ checkout: Checkout }>("POST", `/v1/checkouts/${encodeURIComponent(id)}/cancel`, {})).checkout;
  }
}

class ContractsApi {
  private readonly c: Valtu;
  constructor(c: Valtu) {
    this.c = c;
  }

  /** Contracts on your allowlist (managed in the dashboard, with approval). */
  async list(): Promise<Contract[]> {
    return (await this.c.request<{ contracts: Contract[] }>("GET", "/v1/contracts")).contracts;
  }

  async get(id: string): Promise<Contract & { abi: unknown[] }> {
    return (await this.c.request<{ contract: Contract & { abi: unknown[] } }>("GET", `/v1/contracts/${encodeURIComponent(id)}`)).contract;
  }

  /**
   * Call an allowed function. The result is a transfer of kind CALL that goes
   * through your policies and approvals like a payout.
   */
  async call(input: ContractCallInput): Promise<Transfer> {
    return (await this.c.request<{ transfer: Transfer }>("POST", "/v1/contract-calls", input, { retry: !!input.externalId })).transfer;
  }
}

class MessagesApi {
  private readonly c: Valtu;
  constructor(c: Valtu) {
    this.c = c;
  }

  /**
   * Ask for a message signature. Team signing workspaces only: your team approves
   * it in the dashboard with their passkeys, then it's signed (message.signed webhook).
   */
  async create(input: SignMessageInput): Promise<MessageRequest> {
    return (await this.c.request<{ message: MessageRequest }>("POST", "/v1/messages", input, { retry: !!input.externalId })).message;
  }

  async get(id: string): Promise<MessageRequest> {
    return (await this.c.request<{ message: MessageRequest }>("GET", `/v1/messages/${encodeURIComponent(id)}`)).message;
  }

  /** The 100 most recent requests. */
  async list(params: { status?: MessageRequestStatus } = {}): Promise<MessageRequest[]> {
    return (await this.c.request<{ messages: MessageRequest[] }>("GET", "/v1/messages", undefined, { query: params })).messages;
  }
}

class EventsApi {
  private readonly c: Valtu;
  constructor(c: Valtu) {
    this.c = c;
  }

  /**
   * Workspace events oldest first: the same objects webhooks deliver. Use them to
   * catch up after missed deliveries. Poll with the returned cursor for what comes next.
   */
  async list(q: { after?: string; type?: string; cursor?: string; limit?: number } = {}): Promise<{ events: WebhookEvent[]; nextCursor: string | null; hasMore: boolean }> {
    return this.c.request("GET", "/v1/events", undefined, { query: q as Query });
  }
}

class WebhooksApi {
  private readonly c: Valtu;
  constructor(c: Valtu) {
    this.c = c;
  }

  /** Your endpoints (add and remove them in the dashboard). */
  async list(): Promise<WebhookEndpoint[]> {
    return (await this.c.request<{ webhooks: WebhookEndpoint[] }>("GET", "/v1/webhooks")).webhooks;
  }

  /** The workspace's Ed25519 key for verifying deliveries; pass `publicKey` to constructEvent. */
  async publicKey(): Promise<WebhookPublicKey> {
    return this.c.request<WebhookPublicKey>("GET", "/v1/webhooks/public-key");
  }

  /** Queue a `webhook.test` delivery to one endpoint. */
  async test(id: string): Promise<void> {
    await this.c.request("POST", `/v1/webhooks/${encodeURIComponent(id)}/test`, {});
  }
}

/**
 * A wallet's address on one network ("tron", "ethereum", "bsc", "solana",
 * "bitcoin", …). EVM networks share one address. Null if the wallet has none.
 */
export function depositAddress(wallet: Pick<Wallet, "addresses">, chain: string): string | null {
  return wallet.addresses.find((a) => a.networks.includes(chain))?.address ?? null;
}

async function* paginate<T>(page: (cursor: string | undefined) => Promise<Page<T>>): AsyncGenerator<T> {
  let cursor: string | undefined;
  do {
    const p = await page(cursor);
    yield* p.items;
    cursor = p.nextCursor ?? undefined;
  } while (cursor);
}

function queryString(q: Query | undefined): string {
  if (!q) return "";
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) {
    if (v === undefined || v === null || v === "") continue;
    p.set(k, Array.isArray(v) ? v.join(",") : String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : "";
}

const backoff = (attempt: number) => Math.min(8_000, 300 * 2 ** attempt) * (0.75 + Math.random() * 0.5);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
