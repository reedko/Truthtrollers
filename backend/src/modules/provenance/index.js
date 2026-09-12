import createTraceSupportRoutes from "./traceSupport/traceSupport.routes.js";

export default function createProvenanceRouter({ query }) {
  const router = createTraceSupportRoutes({ query });
  return router;
}
