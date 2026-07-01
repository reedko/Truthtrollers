// /backend/src/routes/publishers/index.js
import { Router } from "express";
import createPublishersRoutes from "./publishers.routes.js";

export default function createPublishersRouter({ query, pool }) {
  const router = Router();

  // Mount publishers sub-routers with dependencies
  router.use("/", createPublishersRoutes({ query, pool }));

  return router;
}
