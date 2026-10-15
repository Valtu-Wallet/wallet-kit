/** A non-2xx answer from the API: `code` is stable, `message` is for people. */
export class ValtuError extends Error {
  readonly status: number;
  readonly code: string;
  /** The API's request id (x-request-id), useful when contacting support. */
  readonly requestId: string | null;
  constructor(status: number, code: string, message: string, requestId: string | null = null) {
    super(message);
    this.name = "ValtuError";
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }
}

/** The webhook's signature, age or body didn't check out: answer 400/401 and drop it. */
export class WebhookVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebhookVerificationError";
  }
}
