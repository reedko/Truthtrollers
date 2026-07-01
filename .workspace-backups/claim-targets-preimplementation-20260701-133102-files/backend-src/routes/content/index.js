// /backend/src/routes/content/index.js
import { Router } from "express";
import createContentCoreRoutes from "./content.core.routes.js";
import createContentTasksRoutes from "./content.tasks.routes.js";
import createContentMetadataRoutes from "./content.metadata.routes.js";
import createContentUrlTrackingRoutes from "./content.url-tracking.routes.js";
import createContentScrapeRoutes from "./content.scrape.routes.js";
import createContentLookupRoutes from "./content.lookup.routes.js";
import createDeleteContentRoutes from "./deleteContent.routes.js";
import createContentIncrementalRoutes from "./content.incremental.routes.js";

export default function createContentRouter({ query, pool, redisClient }) {
  const router = Router();

  // Mount content sub-routers with dependencies
  router.use("/", createContentCoreRoutes({ query, pool }));
  router.use("/", createContentTasksRoutes({ query, pool }));
  router.use("/", createContentMetadataRoutes({ query, pool }));
  router.use("/", createContentUrlTrackingRoutes({ query, pool }));
  router.use("/", createContentScrapeRoutes({ query, pool }));
  router.use("/", createContentLookupRoutes({ query, redisClient })); // Passive lookup routes
  router.use("/", createDeleteContentRoutes({ query, pool }));
  router.use("/", createContentIncrementalRoutes({ query })); // NEW: Incremental claim updates

  return router;
}
