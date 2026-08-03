import path from "node:path";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import {
  sha256,
} from "../artifacts/immutableArtifacts.js";
import type {
  CfxEvidenceInput,
} from "./types.js";

const hashManifestSchema = z.object({
  files: z.array(z.object({
    path: z.string(),
    bytes: z.number().int().nonnegative(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  }).strict()),
  aggregateSha256: z.string().regex(/^[a-f0-9]{64}$/),
}).passthrough();

const handoffSchema = z.object({
  schemaVersion: z.literal("cfx.evidenceSearchHandoff.v2"),
  results: z.array(z.object({
    propositionId: z.string().regex(/^P[0-9]+$/),
    substantiveAssertion: z.string().min(1),
    assertionSource: z.string().min(1),
    articleStance: z.enum(["adopts", "challenges", "reports"]),
    evidenceSearchHandoff: z.object({
      groundingUnitIds: z.array(z.string().regex(/^U[0-9]+$/)),
      groundingText: z.string(),
      literalIdentifiers: z.object({
        people: z.array(z.string()),
        organizations: z.array(z.string()),
        laws: z.array(z.string()),
        studyTitles: z.array(z.string()),
        journals: z.array(z.string()),
        years: z.array(z.string()),
        dateRanges: z.array(z.string()),
        doi: z.array(z.string()),
        pmid: z.array(z.string()),
        urls: z.array(z.string()),
        citationNumbers: z.array(z.string()),
        acronyms: z.array(z.string()),
      }).strict(),
      lookupHints: z.object({
        populations: z.array(z.string()),
        exposures: z.array(z.string()),
        outcomes: z.array(z.string()),
        interventions: z.array(z.string()),
        geography: z.array(z.string()),
        documentTypes: z.array(z.string()),
        topics: z.array(z.string()),
      }).strict(),
      queries: z.object({
        literal: z.array(z.string()),
        sourceQualified: z.array(z.string()),
        studyLookup: z.array(z.string()),
      }).strict(),
    }).passthrough(),
  }).strict()).length(12),
}).passthrough();

export async function loadVerifiedCfxEvidenceInputs(
  runDirectory: string,
): Promise<{
  inputs: CfxEvidenceInput[];
  inputHash: string;
  sourceBytes: Buffer;
  artifactAggregateSha256: string;
}> {
  const directory = path.resolve(runDirectory);
  const manifest = hashManifestSchema.parse(JSON.parse(
    await readFile(path.join(directory, "artifact_hashes.json"), "utf8"),
  ));
  const relativePath = "evidence_search_handoffs.json";
  const expected = manifest.files.find((file) => file.path === relativePath);
  if (!expected) {
    throw new Error(`Missing frozen artifact hash for ${relativePath}`);
  }
  const sourceBytes = await readFile(path.join(directory, relativePath));
  if (
    sourceBytes.length !== expected.bytes
    || sha256(sourceBytes) !== expected.sha256
  ) {
    throw new Error("Frozen CFX evidence-search handoff hash mismatch");
  }
  const parsed = handoffSchema.parse(JSON.parse(sourceBytes.toString()));
  const inputs: CfxEvidenceInput[] = parsed.results.map((row) => ({
    propositionId: row.propositionId,
    substantiveAssertion: row.substantiveAssertion,
    assertionSource: row.assertionSource,
    articleStance: row.articleStance,
    groundingUnitIds: row.evidenceSearchHandoff.groundingUnitIds,
    groundingText: row.evidenceSearchHandoff.groundingText,
    literalIdentifiers: row.evidenceSearchHandoff.literalIdentifiers,
    lookupHints: row.evidenceSearchHandoff.lookupHints,
    deterministicQueries: {
      literalQuery: row.evidenceSearchHandoff.queries.literal[0] ?? null,
      sourceQualifiedQuery:
        row.evidenceSearchHandoff.queries.sourceQualified[0] ?? null,
      studyLookupQueries:
        row.evidenceSearchHandoff.queries.studyLookup,
    },
  }));
  return {
    inputs,
    inputHash: expected.sha256,
    sourceBytes,
    artifactAggregateSha256: manifest.aggregateSha256,
  };
}
