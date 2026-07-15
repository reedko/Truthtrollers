import test from "node:test";
import assert from "node:assert/strict";
import createCf1PublicRoutes from "../../src/routes/claim-foundry/public.routes.js";
import { createValidPackage } from "./fixtures/packages.js";

function response() {
  return { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; } };
}

function routeHandler(router, path, method) {
  const layer = router.stack.find((entry) => entry.route?.path === path
    && entry.route.methods[method]);
  assert.ok(layer, `missing ${method.toUpperCase()} ${path}`);
  return layer.route.stack.at(-1).handle;
}

function request(overrides = {}) {
  const headers = overrides.headers ?? {};
  return { body: {}, params: {}, cf1Consumer: { consumerKey: "consumer-a" },
    get: (name) => headers[name.toLowerCase()], ...overrides };
}

test("public submit returns the portable response contract", async () => {
  const pkg = createValidPackage();
  let submitted;
  const router = createCf1PublicRoutes({ auth: (_req, _res, next) => next(),
    query: async () => [], submit: async (value) => { submitted = value; return {
      claimPackage: pkg, artifactPath: "", run: { status: "ready_for_evidence" } }; } });
  const handler = routeHandler(router, "/v1/claim-packages", "post");
  const res = response();
  await handler(request({ headers: { "idempotency-key": "request-1" },
    body: { article: pkg.article, options: { includePackageInResponse: true } } }), res);
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.packageId, pkg.packageId);
  assert.equal(res.body.summary.targetCount, 1);
  assert.equal(res.body.claimPackage.packageHash, pkg.packageHash);
  assert.equal(submitted.headerIdempotencyKey, "request-1");
  assert.equal(submitted.consumerKey, "consumer-a");
});

test("status and package handlers load consumer-scoped records", async () => {
  const pkg = createValidPackage();
  const query = async (sql, values) => {
    assert.equal(values[1], "consumer-a");
    if (sql.includes("FROM claim_foundry_runs")) return [{ run_id: pkg.runId,
      status: "ready_for_evidence", package_id: pkg.packageId, error_json: null,
      usage_json: '{"totalTokens":150}', artifact_root: null }];
    return [{ package_id: pkg.packageId, package_hash: pkg.packageHash,
      package_json: JSON.stringify(pkg) }];
  };
  const router = createCf1PublicRoutes({ auth: (_req, _res, next) => next(), query,
    submit: async () => assert.fail("not submitted") });
  const statusRes = response();
  await routeHandler(router, "/v1/claim-packages/runs/:runId", "get")(
    request({ params: { runId: pkg.runId } }), statusRes);
  assert.equal(statusRes.body.run.usage.totalTokens, 150);
  const packageRes = response();
  await routeHandler(router, "/v1/claim-packages/:packageId", "get")(
    request({ params: { packageId: pkg.packageId } }), packageRes);
  assert.equal(packageRes.body.claimPackage.packageHash, pkg.packageHash);
});
