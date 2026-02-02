// /backend/src/routes/claims/index.js
import { Router } from "express";
import createClaimsRoutes from "./claims.routes.js";
import createReferenceClaimTaskRoutes from "./referenceClaimTask.routes.js";
import createUserClaimRatingsRoutes from "./userClaimRatings.routes.js";

export default function createClaimsRouter({ query, pool }) {
  const router = Router();
  router.use("/", createClaimsRoutes({ query, pool }));
  router.use("/", createReferenceClaimTaskRoutes({ query, pool }));
  router.use("/", createUserClaimRatingsRoutes({ query, pool }));
  return router;
}
