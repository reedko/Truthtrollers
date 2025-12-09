// backend/src/routes/evidence/index.js
import { Router } from "express";
import createEvidenceRoutes from "./evidence.routes.js";

export default function createEvidenceRouter({ query, pool }) {
  const router = Router();

  // Mount evidence routes with dependencies
  router.use("/", createEvidenceRoutes({ query, pool }));

  return router;
}
