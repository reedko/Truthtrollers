import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

export const CFX_BACKEND_ROOT = path.resolve(here, "../../../..");
export const CFX_REPOSITORY_ROOT = path.resolve(CFX_BACKEND_ROOT, "..");

export function cfxTimestamp(): string {
  return new Date().toISOString().replace(/\D/g, "").slice(0, 14);
}

export function option(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}
