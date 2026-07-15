import test from "node:test";
import assert from "node:assert/strict";
import createVeriStrataShadowRoutes from "../../src/routes/claim-foundry/veristrata.routes.js";
import { createValidPackage } from "./fixtures/packages.js";

function response() {
  return { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; } };
}

test("VeriStrata shadow route returns mode and content binding identity", async () => {
  const pkg = createValidPackage();
  let input;
  const router = createVeriStrataShadowRoutes({ runShadow: async (value) => {
    input = value;
    return { claimPackage: pkg, run: { usage: {} }, artifactRefs: { artifactRoot: null } };
  } });
  const layer = router.stack.find((entry) => entry.route?.path === "/api/claim-foundry/run");
  const handler = layer.route.stack.at(-1).handle;
  const res = response();
  await handler({ body: { contentId: 7, includePackageInResponse: false },
    user: { user_id: 2, role: "user" }, get: () => "shadow-7" }, res);
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.mode, "shadow");
  assert.equal(res.body.contentId, 7);
  assert.equal(res.body.claimPackage, null);
  assert.equal(input.userId, 2);
});

test("activation route is super-admin-only and delegates an explicit binding", async () => {
  let received;
  const router = createVeriStrataShadowRoutes({ runShadow: async () => ({}), activationEnabled: true,
    activateProjection: async (input) => {
    received = input; return { bindingId: input.bindingId, packageId: "cf1pkg_one", contentId: 7 };
  } });
  const layer = router.stack.find((item) => item.route?.path === "/api/claim-foundry/activate");
  const handler = layer.route.stack.at(-1).handle;
  const forbidden = response();
  await handler({ user: { role: "user" }, body: { bindingId: 8 } }, forbidden);
  assert.equal(forbidden.statusCode, 403);
  const allowed = response();
  await handler({ user: { role: "super_admin" }, body: { bindingId: 8 } }, allowed);
  assert.deepEqual(received, { bindingId: 8 });
  assert.equal(allowed.body.mode, "active");
});
