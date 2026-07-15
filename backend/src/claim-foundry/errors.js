export class Cf1Error extends Error {
  constructor(code, message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = "Cf1Error";
    this.code = code;
    this.status = options.status ?? 500;
    this.retryable = options.retryable ?? false;
    this.path = options.path ?? null;
    this.issues = Object.freeze([...(options.issues ?? [])]);
  }
}

export class Cf1InputError extends Cf1Error {
  constructor(code, message, options = {}) {
    super(code, message, { status: 400, ...options, retryable: false });
    this.name = "Cf1InputError";
  }
}

export function isRetryableCf1Error(error) {
  return error instanceof Cf1Error && error.retryable === true;
}

export function assertCf1(condition, code, message, options) {
  if (!condition) throw new Cf1InputError(code, message, options);
}
