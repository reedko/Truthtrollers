// /backend/src/routes/claims/index.js
import { Router } from "express";
import createClaimsRoutes from "./claims.routes.js";

export default function createClaimsRouter({ query, pool }) {
  const router = Router();
  router.use("/", createClaimsRoutes({ query, pool }));
  return router;
}
