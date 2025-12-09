// /backend/src/routes/users/index.js
import { Router } from "express";
import createUsersRoutes from "./users.routes.js";
import createUserAssignmentsRoutes from "./user-assignments.routes.js";

export default function createUsersRouter({ query, pool }) {
  const router = Router();

  // Mount users sub-routers with dependencies
  router.use("/", createUsersRoutes({ query, pool }));
  router.use("/", createUserAssignmentsRoutes({ query, pool }));

  return router;
}
