import { createHash } from "node:crypto";
import {
  chmod,
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

function sha256(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

async function writeImmutableJson(
  filePath: string,
  value: unknown,
): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
}

export class GOnlyForensicWriter {
  readonly requestsDirectory: string;
  readonly responsesDirectory: string;

  constructor(readonly outputDirectory: string) {
    this.requestsDirectory = path.join(outputDirectory, "requests");
    this.responsesDirectory = path.join(outputDirectory, "responses");
  }

  async initialize(): Promise<void> {
    await mkdir(path.dirname(this.outputDirectory), { recursive: true });
    await mkdir(this.outputDirectory, { recursive: false });
    await mkdir(this.requestsDirectory, { recursive: false });
    await mkdir(this.responsesDirectory, { recursive: false });
  }

  async beginRequest(input: {
    requestKey: string;
    request: Record<string, unknown>;
  }): Promise<void> {
    await writeImmutableJson(
      path.join(this.requestsDirectory, `${input.requestKey}.json`),
      input.request,
    );
  }

  async recordResponse(input: {
    requestKey: string;
    rawResponse: unknown;
    metadata: Record<string, unknown>;
  }): Promise<void> {
    await writeImmutableJson(
      path.join(this.responsesDirectory, `${input.requestKey}.json`),
      input.rawResponse,
    );
    await writeImmutableJson(
      path.join(this.responsesDirectory, `${input.requestKey}.metadata.json`),
      input.metadata,
    );
  }

  async recordError(input: {
    requestKey: string;
    error: unknown;
    metadata: Record<string, unknown>;
  }): Promise<void> {
    await writeImmutableJson(
      path.join(this.responsesDirectory, `${input.requestKey}.error.json`),
      {
        name: input.error instanceof Error ? input.error.name : "Error",
        message: input.error instanceof Error
          ? input.error.message
          : String(input.error),
      },
    );
    await writeImmutableJson(
      path.join(this.responsesDirectory, `${input.requestKey}.metadata.json`),
      input.metadata,
    );
  }
}

async function filesRecursively(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const filePath = path.join(directory, entry.name);
    return entry.isDirectory() ? filesRecursively(filePath) : [filePath];
  }));
  return nested.flat().sort();
}

export async function hashGOnlyArtifacts(
  outputDirectory: string,
): Promise<Array<{ name: string; bytes: number; sha256: string }>> {
  const files = await filesRecursively(outputDirectory);
  return Promise.all(files
    .filter((filePath) => path.basename(filePath) !== "artifact_hashes.json")
    .map(async (filePath) => {
      const content = await readFile(filePath);
      return {
        name: path.relative(outputDirectory, filePath),
        bytes: content.length,
        sha256: sha256(content),
      };
    }));
}

export function aggregateGOnlyArtifactHash(
  files: Array<{ name: string; bytes: number; sha256: string }>,
): string {
  return sha256(JSON.stringify(files));
}

export async function freezeGOnlyArtifacts(
  outputDirectory: string,
): Promise<void> {
  const files = await filesRecursively(outputDirectory);
  for (const filePath of files) await chmod(filePath, 0o444);
  const directories = [
    path.join(outputDirectory, "requests"),
    path.join(outputDirectory, "responses"),
    outputDirectory,
  ];
  for (const directory of directories) {
    if ((await stat(directory)).isDirectory()) await chmod(directory, 0o555);
  }
}
