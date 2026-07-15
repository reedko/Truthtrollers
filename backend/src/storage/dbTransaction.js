import { promisify } from "node:util";
import { pool as defaultPool } from "../db/pool.js";

function call(target, method, ...args) {
  if (typeof target?.[method] !== "function") throw new TypeError(`Database port requires ${method}()`);
  if (target[method].length > args.length) {
    return promisify(target[method]).bind(target)(...args);
  }
  return Promise.resolve(target[method](...args));
}

export function connectionQuery(connection, sql, values = []) {
  return call(connection, "query", sql, values);
}

export async function acquireConnection(pool = defaultPool) {
  return call(pool, "getConnection");
}

export async function withTransaction(work, { pool = defaultPool } = {}) {
  if (typeof work !== "function") throw new TypeError("Transaction work function is required");
  const connection = await acquireConnection(pool);
  try {
    await call(connection, "beginTransaction");
    const result = await work({ connection, query: (sql, values) => connectionQuery(connection, sql, values) });
    await call(connection, "commit");
    return result;
  } catch (error) {
    try { await call(connection, "rollback"); } catch (rollbackError) { error.rollbackError = rollbackError; }
    throw error;
  } finally {
    if (typeof connection.release === "function") connection.release();
  }
}
