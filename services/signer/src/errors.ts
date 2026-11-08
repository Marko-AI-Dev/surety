export const ERROR_STATUS = {
  bad_request: 400,
  unauthenticated: 401,
  destination_not_allowed: 403,
  amount_over_cap: 403,
  authorization_invalid: 403,
  not_found: 404,
  escrow_not_found: 404,
  cancel_window_invalid: 400,
  authorization_consumed: 409,
  escrow_mismatch: 409,
  finish_window_closed: 409,
  cancel_not_yet_eligible: 409,
  op_conflict: 409,
  op_pending: 409,
  internal_error: 500,
  ledger_failure: 502,
} as const;

export type SignerErrorCode = keyof typeof ERROR_STATUS;

export class SignerError extends Error {
  readonly status: number;

  constructor(
    readonly code: SignerErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SignerError";
    this.status = ERROR_STATUS[code];
  }
}
