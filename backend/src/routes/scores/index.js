// /backend/src/routes/scores/index.js
import { Router } from "express";
import createScoresRoutes from "./scores.routes.js";

export default function createScoresRouter({ query, pool }) {
  const router = Router();
  router.use("/", createScoresRoutes({ query, pool }));
  return router;
}
