export class Cf7Error extends Error {
  readonly name = "Cf7Error";

  constructor(
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}
