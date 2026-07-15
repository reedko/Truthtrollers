import { v7 as uuidv7, validate as validateUuid, version as uuidVersion } from "uuid";
import { CF1_ID_PREFIXES } from "./contract.js";

function createPrefixedId(prefix) {
  return `${prefix}${uuidv7()}`;
}

function isPrefixedUuidV7(value, prefix) {
  if (typeof value !== "string" || !value.startsWith(prefix)) return false;
  const uuid = value.slice(prefix.length);
  return validateUuid(uuid) && uuidVersion(uuid) === 7;
}

export function createRunId() {
  return createPrefixedId(CF1_ID_PREFIXES.run);
}

export function createPackageId() {
  return createPrefixedId(CF1_ID_PREFIXES.package);
}

export function createLineageId() {
  return createPrefixedId(CF1_ID_PREFIXES.lineage);
}

export function isRunId(value) {
  return isPrefixedUuidV7(value, CF1_ID_PREFIXES.run);
}

export function isPackageId(value) {
  return isPrefixedUuidV7(value, CF1_ID_PREFIXES.package);
}

export function isLineageId(value) {
  return isPrefixedUuidV7(value, CF1_ID_PREFIXES.lineage);
}

export function assignLocalIds(items, { prefix, digits, field }) {
  if (!Array.isArray(items)) throw new TypeError("items must be an array");
  if (!prefix || !field || !Number.isInteger(digits) || digits < 1) {
    throw new TypeError("prefix, field, and positive integer digits are required");
  }
  const maximum = (10 ** digits) - 1;
  if (items.length > maximum) throw new RangeError(`cannot assign more than ${maximum} IDs`);

  return items.map((item, index) => ({
    ...item,
    [field]: `${prefix}${String(index + 1).padStart(digits, "0")}`,
  }));
}
