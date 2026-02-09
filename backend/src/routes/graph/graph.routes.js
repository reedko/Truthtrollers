// /backend/src/routes/graph/graph.routes.js
import { Router } from "express";
import {
  getNodesForEntity,
  getLinksForEntity,
  getLinkedClaimsAndLinksForTask,
} from "../../queries/graphQueries.js";

export default function createGraphRoutes({ query, pool }) {
  const router = Router();

  // GET /api/get-graph-data
  // Molecule map route - fetches nodes and links for entity visualization
  router.get("/api/get-graph-data", async (req, res) => {
    const { entity, entityType } = req.query;

    if (!entity || !entityType) {
      return res
        .status(400)
        .json({ error: "Missing entity or entityType parameter" });
    }

    const nodeSql = getNodesForEntity(entityType);
    const linkSql = getLinksForEntity(entityType);

    if (!nodeSql || !linkSql) {
      return res.status(400).json({ error: "Invalid entityType parameter" });
    }

    try {
      // Task entityType needs 5 params due to AI evidence rating calculation
      const nodeParams = entityType === 'task'
        ? [entity, entity, entity, entity, entity]
        : [entity, entity, entity, entity];
      const nodes = await query(nodeSql, nodeParams);
      const links = await query(linkSql, [entity, entity, entity, entity]);

      // Ensure JSON-safe response
      res.json({
        nodes: JSON.parse(JSON.stringify(nodes)),
        links: JSON.parse(JSON.stringify(links)),
      });
    } catch (error) {
      console.error("🚨 SQL Error:", error);
      res.status(500).json({ error: "Database query failed", details: error });
    }
  });

  // GET /api/full-graph/:taskId
  // Full graph route - includes base entity graph + claim nodes and claim links for a task
  router.get("/api/full-graph/:taskId", async (req, res) => {
    const { entity, entityType } = req.query;
    const taskId = parseInt(req.params.taskId);
    const viewerId = req.query.viewerId ? parseInt(req.query.viewerId) : null;

    if (!entity || !entityType) {
      return res
        .status(400)
        .json({ error: "Missing entity or entityType parameter" });
    }

    const nodeSql = getNodesForEntity(entityType);
    const linkSql = getLinksForEntity(entityType);

    if (!nodeSql || !linkSql) {
      return res.status(400).json({ error: "Invalid entityType parameter" });
    }

    console.log(entity);
    try {
      // 1. Base nodes/links
      // Task entityType needs 5 params due to AI evidence rating calculation
      const nodeParams = entityType === 'task'
        ? [entity, entity, entity, entity, entity]
        : [entity, entity, entity, entity];
      const nodes = await query(nodeSql, nodeParams);
      const links = await query(linkSql, [entity, entity, entity, entity]);

      // 2. Only claims & links actually connected to the task
      const { claimNodeSql, claimNodeParams, claimLinkSql, claimLinkParams } =
        getLinkedClaimsAndLinksForTask(taskId, viewerId);
      const claimNodes = await query(claimNodeSql, claimNodeParams);
      const claimLinks = await query(claimLinkSql, claimLinkParams);

      // 3. Merge and return
      res.json({
        nodes: JSON.parse(JSON.stringify([...nodes, ...claimNodes])),
        links: [...links, ...claimLinks],
      });
    } catch (err) {
      console.error("🌐 Full Graph Error:", err);
      res.status(500).json({ error: "Failed to build full graph" });
    }
  });

  return router;
}
