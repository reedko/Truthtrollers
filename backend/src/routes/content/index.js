// /backend/src/routes/content/index.js
import { Router } from "express";
import createContentCoreRoutes from "./content.core.routes.js";
import createContentTasksRoutes from "./content.tasks.routes.js";
import createContentMetadataRoutes from "./content.metadata.routes.js";
import createContentUrlTrackingRoutes from "./content.url-tracking.routes.js";
import createContentScrapeRoutes from "./content.scrape.routes.js";

export default function createContentRouter({ query, pool }) {
  const router = Router();

  // Mount content sub-routers with dependencies
  router.use("/", createContentCoreRoutes({ query, pool }));
  router.use("/", createContentTasksRoutes({ query, pool }));
  router.use("/", createContentMetadataRoutes({ query, pool }));
  router.use("/", createContentUrlTrackingRoutes({ query, pool }));
  router.use("/", createContentScrapeRoutes({ query, pool }));

  return router;
}
