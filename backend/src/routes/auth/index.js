// /backend/src/routes/auth/index.js
import { Router } from "express";
import createAuthRoutes from "./auth.routes.js";
import createSessionRoutes from "./session.routes.js";

export default function createAuthRouter({ query, pool }) {
  const router = Router();

  // Mount auth sub-routers with dependencies
  router.use("/", createAuthRoutes({ query, pool }));
  router.use("/", createSessionRoutes({ query, pool }));

  return router;
}
