import { insertReferenceClaimLink } from "../src/queries/referenceClaimLinks.js";

export function registerReferenceClaimRoutes(app, query) {
  app.post("/api/reference-claim-links", async (req, res) => {
    try {
      const id = await insertReferenceClaimLink(query, req.body);
      res.json({ success: true, id });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "DB error" });
    }
  });
}
