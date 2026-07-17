import { CF1_POSTURE_FIRST_ORDER_TRACE_SCHEMA }
  from "./setEPostureFirstOrderSchemaV1.js";

// Test-only E3 schema: source kind is constrained independently of source name.
export const CF1_POSTURE_FIRST_SOURCE_STABLE_SCHEMA_V3 = (() => {
  const schema = structuredClone(CF1_POSTURE_FIRST_ORDER_TRACE_SCHEMA);
  schema.name = "cf1_semantic_inventory_posture_first_source_stable_v3";
  const candidate = schema.schema.properties.candidateClaims.items;
  candidate.required = candidate.required.flatMap((field) => field === "assertionSource"
    ? ["assertionSourceKind", "assertionSourceName"] : [field]);
  const properties = candidate.properties;
  const rebuilt = {};
  for (const [name, value] of Object.entries(properties)) {
    if (name === "assertionSource") {
      rebuilt.assertionSourceKind = { type: "string", enum: ["article_author", "named_source", "unknown"] };
      rebuilt.assertionSourceName = { type: "string", minLength: 1, maxLength: 300 };
    } else rebuilt[name] = value;
  }
  candidate.properties = rebuilt;
  return Object.freeze(schema);
})();

export function postureFirstSourceStableSchemaForArticle(article) {
  const schema = structuredClone(CF1_POSTURE_FIRST_SOURCE_STABLE_SCHEMA_V3);
  if (String(article?.text ?? "").length >= 5_000) schema.schema.properties.candidateClaims.minItems = 8;
  return schema;
}
