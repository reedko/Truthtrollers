// /backend/src/routes/credibility/index.js
import { Router } from "express";
import createCredibilityRoutes from "./credibility.routes.js";

export default function createCredibilityRouter({ query, pool }) {
  const router = Router();

  // Mount credibility routes
  router.use("/", createCredibilityRoutes({ query, pool }));

  return router;
}
