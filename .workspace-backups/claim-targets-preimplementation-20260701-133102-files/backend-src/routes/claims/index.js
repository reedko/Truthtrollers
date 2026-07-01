// /backend/src/routes/claims/index.js
import { Router } from "express";
import createClaimsRoutes from "./claims.routes.js";
import createReferenceClaimTaskRoutes from "./referenceClaimTask.routes.js";
import createUserClaimRatingsRoutes from "./userClaimRatings.routes.js";
import createClaimEditRoutes from "./claims.edit.routes.js";
import createClaimTriageRoutes from "./claims.triage.routes.js";

export default function createClaimsRouter({ query, pool }) {
  const router = Router();
  router.use("/", createClaimsRoutes({ query, pool }));
  router.use("/", createReferenceClaimTaskRoutes({ query, pool }));
  router.use("/", createUserClaimRatingsRoutes({ query, pool }));
  router.use("/", createClaimEditRoutes({ query, pool })); // Single-claim editing with evidence re-run
  router.use("/", createClaimTriageRoutes({ query, pool })); // Claim triage & source quality scoring
  return router;
}
