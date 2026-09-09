import test from "node:test";
import assert from "node:assert/strict";

import { persistPublishers } from "../src/storage/persistPublishers.js";

test("legacy content_publishers schema bypasses normalized role columns", async () => {
  const statements = [];
  const query = async (sql, params = []) => {
    statements.push({ sql, params });
    if (sql.includes("information_schema.COLUMNS")) return [{ column_count: 0 }];
    if (sql.includes("FROM publishers")) return [{ publisher_id: 44 }];
    return { affectedRows: 1 };
  };

  const publisherId = await persistPublishers(query, 77, "Example Publisher");

  assert.equal(publisherId, 44);
  assert.ok(
    statements.some(({ sql, params }) =>
      sql.includes("INSERT IGNORE INTO content_publishers (content_id, publisher_id)")
      && params[0] === 77
      && params[1] === 44),
  );
  const writes = statements.filter(({ sql }) => /^(INSERT|UPDATE|DELETE)/i.test(sql.trim()));
  assert.equal(writes.some(({ sql }) => sql.includes("is_primary")), false);
  assert.equal(writes.some(({ sql }) => sql.includes("publisher_role")), false);
});
