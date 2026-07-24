import { splitCall1aDiscoverySchemaForArticle }
  from "./splitCall1aDiscoverySchemaV1.js";

export function p1aVariantSchema({ label, assertionTerminology = false,
  removeMateriality = false } = {}) {
  const schema = splitCall1aDiscoverySchemaForArticle();
  schema.name = label;
  let collection = schema.schema.properties.candidateClaims;
  if (assertionTerminology) {
    schema.schema.properties.assertions = collection;
    delete schema.schema.properties.candidateClaims;
    schema.schema.required = schema.schema.required.map((field) =>
      field === "candidateClaims" ? "assertions" : field);
    collection.items.properties.assertionText = collection.items.properties.claimText;
    delete collection.items.properties.claimText;
    collection.items.required = collection.items.required.map((field) =>
      field === "claimText" ? "assertionText" : field);
  }
  if (removeMateriality) {
    delete collection.items.properties.materiality;
    collection.items.required = collection.items.required.filter((field) =>
      field !== "materiality");
  }
  return schema;
}

export function normalizeP1aVariantOutput(output, { assertionTerminology = false } = {}) {
  if (!assertionTerminology) return output;
  const { assertions = [], ...orientation } = output ?? {};
  return { ...orientation, candidateClaims: assertions.map(({ assertionText, ...item }) =>
    ({ ...item, claimText: assertionText })) };
}
