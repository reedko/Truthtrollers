// backend/src/core/ports.js

// This file is purely for documentation / reference of the dependency shapes.
// It does NOT enforce types at runtime, but shows what EvidenceEngine expects.

/**
 * @typedef {Object} LLMJson
 * @property {(args: {
 *   system: string,
 *   user: string,
 *   schemaHint: string,
 *   temperature?: number
 * }) => Promise<any>} generate
 */

/**
 * @typedef {Object} SearchPorts
 * @property {(args: {
 *   query: string,
 *   topK: number,
 *   prefer?: string[],
 *   avoid?: string[]
 * }) => Promise<Array<CandidateDoc>>} web
 * @property {(args: {
 *   query: string,
 *   topK: number
 * }) => Promise<Array<CandidateDoc>>} internal
 */

/**
 * @typedef {Object} FetcherPort
 * @property {(candidate: CandidateDoc) => Promise<string>} getText
 */

/**
 * @typedef {Object} StoragePort
 * @property {(key: string) => Promise<any | undefined>} cacheGet
 * @property {(key: string, value: any, ttlSec?: number) => Promise<void>} cacheSet
 * @property {(results: ClaimMappingResult[]) => Promise<void>} persistResults
 */

/**
 * @typedef {Object} EngineDeps
 * @property {LLMJson} llm
 * @property {SearchPorts} search
 * @property {FetcherPort} fetcher
 * @property {StoragePort} storage
 */

// These exports are mostly here so other files can import from "./ports.js"
// for clarity, even though JS doesn't use the typedefs at runtime.
export {};
