import test from "node:test";
import assert from "node:assert/strict";
import { createCf1ConsumerAuth, parseCf1ConsumerKeys } from "../../src/routes/claim-foundry/consumerAuth.js";

function response() {
  return { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; } };
}

test("consumer credentials are parsed and bounded", () => {
  assert.deepEqual(parseCf1ConsumerKeys('{"secret":"consumer-a"}'), { secret: "consumer-a" });
  assert.throws(() => parseCf1ConsumerKeys("[]"), /must be/);
  assert.throws(() => parseCf1ConsumerKeys('{"":"consumer"}'), /invalid/);
});

test("consumer auth accepts API key or bearer and rejects missing credentials", () => {
  const auth = createCf1ConsumerAuth({ consumerKeys: { secret: "consumer-a" } });
  for (const headers of [{ "x-api-key": "secret" }, { authorization: "Bearer secret" }]) {
    const req = { get: (name) => headers[name.toLowerCase()] };
    let next = false;
    auth(req, response(), () => { next = true; });
    assert.equal(next, true);
    assert.equal(req.cf1Consumer.consumerKey, "consumer-a");
  }
  const res = response();
  auth({ get: () => undefined }, res, () => assert.fail("must not continue"));
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.error.code, "CF1_AUTH_REQUIRED");
});
