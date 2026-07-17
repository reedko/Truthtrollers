export class Er1Error extends Error {
  constructor(code, message, details = {}, status = 422) {
    super(message);
    this.name = "Er1Error";
    this.code = code;
    this.details = details;
    this.status = status;
  }
}

export function er1Fail(code, message, details, status) {
  throw new Er1Error(code, message, details, status);
}
