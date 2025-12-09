// /backend/src/routes/graph/index.js
import { Router } from "express";
import createGraphRoutes from "./graph.routes.js";

export default function createGraphRouter({ query, pool }) {
  const router = Router();
  router.use("/", createGraphRoutes({ query, pool }));
  return router;
}
