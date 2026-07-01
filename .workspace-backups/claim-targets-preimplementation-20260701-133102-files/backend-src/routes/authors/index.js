// /backend/src/routes/authors/index.js
import { Router } from "express";
import createAuthorsRoutes from "./authors.routes.js";

export default function createAuthorsRouter({ query, pool }) {
  const router = Router();

  // Mount authors sub-routers with dependencies
  router.use("/", createAuthorsRoutes({ query, pool }));

  return router;
}
