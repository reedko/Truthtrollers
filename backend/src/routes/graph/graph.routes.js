// /backend/src/routes/graph/graph.routes.js
import { Router } from "express";
import {
  getNodesForEntity,
  getLinksForEntity,
  getLinkedClaimsAndLinksForTask,
  getCaseClaimsForTask,
  getSourceToClaimLinks,
  getUnlinkedSourcesForTask,
  getAISuggestedLinksForUnlinkedSources,
} from "../../queries/graphQueries.js";

export default function createGraphRoutes({ query, pool }) {
  const router = Router();

  // GET /api/get-graph-data
  // Molecule map route - fetches nodes and links for entity visualization
  router.get("/api/get-graph-data", async (req, res) => {
    const { entity, entityType } = req.query;
    const viewerId = req.query.viewerId ? parseInt(req.query.viewerId) : null;

    if (!entity || !entityType) {
      return res
        .status(400)
        .json({ error: "Missing entity or entityType parameter" });
    }

    const nodeSql = getNodesForEntity(entityType, viewerId);
    const linkSql = getLinksForEntity(entityType, viewerId);

    if (!nodeSql || !linkSql) {
      return res.status(400).json({ error: "Invalid entityType parameter" });
    }

    try {
      // Task entityType needs 6 params for nodes, 4 params for links
      // viewerId is now embedded directly in the SQL string (not a parameter)
      const nodeParams = entityType === 'task'
        ? [entity, entity, entity, entity, entity, entity]
        : [entity, entity, entity, entity];
      const linkParams = entityType === 'task'
        ? [entity, entity, entity, entity]
        : [entity, entity, entity, entity];
      const nodes = await query(nodeSql, nodeParams);
      const links = await query(linkSql, linkParams);

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
    const { entity, entityType, viewScope } = req.query;
    const taskId = parseInt(req.params.taskId);
    const viewerId = req.query.viewerId ? parseInt(req.query.viewerId) : null;

    if (!entity || !entityType) {
      return res
        .status(400)
        .json({ error: "Missing entity or entityType parameter" });
    }

    const nodeSql = getNodesForEntity(entityType, viewerId);
    const linkSql = getLinksForEntity(entityType, viewerId);

    if (!nodeSql || !linkSql) {
      return res.status(400).json({ error: "Invalid entityType parameter" });
    }

    console.log(entity);
    try {
      // 1. Base nodes/links
      // Task entityType needs 6 params for nodes (task, task authors, reference authors, publisher, references x2)
      // Task entityType needs 4 params for links (task author, task publisher, task references, reference authors)
      // viewerId is now embedded directly in the SQL string (not a parameter)
      const nodeParams = entityType === 'task'
        ? [entity, entity, entity, entity, entity, entity]
        : [entity, entity, entity, entity];
      const linkParams = entityType === 'task'
        ? [entity, entity, entity, entity]
        : [entity, entity, entity, entity];
      const nodes = await query(nodeSql, nodeParams);
      const links = await query(linkSql, linkParams);

      // 2. Only claims & links actually connected to the task
      const { claimNodeSql, claimNodeParams, claimLinkSql, claimLinkParams } =
        getLinkedClaimsAndLinksForTask(taskId, viewerId, viewScope);
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

  // GET /api/case-claim-expansion/:taskId
  // Fetch case claims and their connections to sources for the expanded view
  router.get("/api/case-claim-expansion/:taskId", async (req, res) => {
    const taskId = parseInt(req.params.taskId);
    const viewerId = req.query.viewerId ? parseInt(req.query.viewerId) : null;
    const viewScope = req.query.viewScope || 'user';

    if (!taskId) {
      return res.status(400).json({ error: "Missing taskId parameter" });
    }

    try {
      // 1. Get all case claims for this task
      const caseClaimsSql = getCaseClaimsForTask(taskId);
      const caseClaims = await query(caseClaimsSql, [taskId]);

      // 2. Get source-to-claim links (both user and AI)
      const sourceToClaimLinksSql = getSourceToClaimLinks(taskId, viewerId, viewScope);
      const shouldFilterByUser = viewScope !== 'all' && Number.isInteger(viewerId);
      const sourceToClaimParams = shouldFilterByUser ? [taskId, viewerId] : [taskId];
      const sourceToClaimLinks = await query(sourceToClaimLinksSql, sourceToClaimParams);

      // 3. Get unlinked sources (sources without any claim links)
      const unlinkedSourcesSql = getUnlinkedSourcesForTask(taskId, viewerId, viewScope);
      const unlinkedSourcesParams = shouldFilterByUser
        ? [taskId, taskId, viewerId]
        : [taskId, taskId];
      const unlinkedSources = await query(unlinkedSourcesSql, unlinkedSourcesParams);

      // 4. Get AI-suggested links for positioning
      const aiSuggestedLinksSql = getAISuggestedLinksForUnlinkedSources(taskId);
      const aiSuggestedLinks = await query(aiSuggestedLinksSql, [taskId, taskId]);

      res.json({
        caseClaims: JSON.parse(JSON.stringify(caseClaims)),
        sourceToClaimLinks: JSON.parse(JSON.stringify(sourceToClaimLinks)),
        unlinkedSources: JSON.parse(JSON.stringify(unlinkedSources)),
        aiSuggestedLinks: JSON.parse(JSON.stringify(aiSuggestedLinks)),
      });
    } catch (err) {
      console.error("🌐 Case Claim Expansion Error:", err);
      res.status(500).json({ error: "Failed to fetch case claim expansion data", details: err.message });
    }
  });

  return router;
}
