import { createHash } from "node:crypto";
import {
  chmod,
  mkdir,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

export function sha256(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

export async function writeImmutableJson(
  filePath: string,
  value: unknown,
): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
}

export async function hashWholeArticleBurdenArtifacts(
  outputDirectory: string,
): Promise<Array<{ name: string; bytes: number; sha256: string }>> {
  const entries = await readdir(outputDirectory, { withFileTypes: true });
  const files = entries
    .filter((entry) =>
      entry.isFile() && entry.name !== "artifact_hashes.json")
    .map((entry) => entry.name)
    .sort();
  return Promise.all(files.map(async (name) => {
    const content = await readFile(path.join(outputDirectory, name));
    return { name, bytes: content.length, sha256: sha256(content) };
  }));
}

export function aggregateWholeArticleBurdenHash(
  files: Array<{ name: string; bytes: number; sha256: string }>,
): string {
  return sha256(JSON.stringify(files));
}

export async function freezeWholeArticleBurdenArtifacts(
  outputDirectory: string,
): Promise<void> {
  const entries = await readdir(outputDirectory, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isFile()) {
      await chmod(path.join(outputDirectory, entry.name), 0o444);
    }
  }
  await chmod(outputDirectory, 0o555);
}

export async function createWholeArticleBurdenDirectory(
  outputDirectory: string,
): Promise<void> {
  await mkdir(path.dirname(outputDirectory), { recursive: true });
  await mkdir(outputDirectory, { recursive: false });
}
