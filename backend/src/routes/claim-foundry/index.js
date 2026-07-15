import { Router } from "express";
import { createCf1ConsumerAuth } from "./consumerAuth.js";
import createCf1PublicRoutes from "./public.routes.js";
import { submitCf1Package } from "./submitService.js";
import createVeriStrataShadowRoutes from "./veristrata.routes.js";
import { runVeriStrataShadow } from "../../claim-foundry/veristrata/runShadow.js";
import { activateCf1Projection } from "../../claim-foundry/veristrata/activateProjection.js";

export default function createClaimFoundryRouter(dependencies) {
  const router = Router();
  const auth = dependencies.auth ?? createCf1ConsumerAuth({ consumerKeys: dependencies.consumerKeys });
  const submit = dependencies.submit ?? ((request) => submitCf1Package(request, dependencies));
  const runShadow = dependencies.runShadow ?? ((input) => runVeriStrataShadow(input, {
    ...dependencies, submit, consumerKey: dependencies.internalConsumerKey ?? "veristrata",
  }));
  const activateProjection = dependencies.activateProjection ?? ((input) => activateCf1Projection(input, dependencies));
  router.use(createCf1PublicRoutes({ auth, submit, query: dependencies.query }));
  router.use(createVeriStrataShadowRoutes({ runShadow, activateProjection,
    activationEnabled: dependencies.activationEnabled === true }));
  return router;
}
