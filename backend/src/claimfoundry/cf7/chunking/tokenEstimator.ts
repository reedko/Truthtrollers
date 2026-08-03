import { get_encoding } from "tiktoken";

const encoder = get_encoding("cl100k_base");

export function estimateCf7Tokens(text: string): number {
  return encoder.encode(text).length;
}
