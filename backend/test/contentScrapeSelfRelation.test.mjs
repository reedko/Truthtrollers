import test from "node:test";
import assert from "node:assert/strict";

import createContentScrapeRoutes from "../src/routes/content/content.scrape.routes.js";

test("duplicate publisher retry never creates a self content relation", async () => {
  const queries = [];
  const query = async (sql, params = []) => {
    queries.push({ sql, params });
    if (sql.includes("SELECT content_id, content_name FROM content")) {
      return [{ content_id: 23659, content_name: "NHS Ransomware Cyber-Attack Was Preventable" }];
    }
    if (sql.includes("SELECT admiralty_code FROM admiralty_evaluations")) {
      return [{ admiralty_code: "A1" }];
    }
    return [];
  };

  const router = createContentScrapeRoutes({ query });
  const layer = router.stack.find(
    (candidate) => candidate.route?.path === "/api/scrape-reference",
  );
  assert.ok(layer, "scrape-reference route should exist");

  const response = await new Promise((resolve, reject) => {
    const req = {
      body: {
        url: "https://www.scientificamerican.com/article/nhs-ransomware-cyber-attack-was-preventable/",
        taskContentId: 23659,
      },
      user: null,
    };
    const res = {
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(body) {
        resolve({ statusCode: this.statusCode || 200, body });
      },
    };
    Promise.resolve(layer.route.stack[0].handle(req, res)).catch(reject);
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.duplicate, true);
  assert.equal(
    queries.some(({ sql }) => sql.includes("INSERT INTO content_relations")),
    false,
  );
});
