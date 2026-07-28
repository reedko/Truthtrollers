import { buildCf2V6DiscoveryPrompt } from "../v6/prompts.js";

export const V6_ATTRIBUTION_INSTRUCTION =
  `- Preserve a reporting frame in rawAssertion when it identifies who supplied the
  assertion. A later call will separate source from substance.
- groundingUnitIds must independently support the assertion. For an attributed
  assertion, include the local unit that identifies its supplier.`;

export const V7_ATTRIBUTION_INSTRUCTION =
  `- Preserve an attribution frame only when that frame is explicitly present in the
  cited article units. Never append or synthesize "according to X" or another supplier
  label absent from those units. A later call will separate an explicit frame from the
  substantive assertion.
- groundingUnitIds must independently support the assertion. When a neighboring unit
  identifies the supplier, include that unit in groundingUnitIds without adding new
  attribution language to rawAssertion.`;

export function buildCf2V7DiscoveryPrompt(args) {
  const baseline = buildCf2V6DiscoveryPrompt(args);
  if (!baseline.user.includes(V6_ATTRIBUTION_INSTRUCTION)) {
    throw new Error("CF2 V7 could not locate the protected V6 attribution instruction");
  }
  return {
    ...baseline,
    user: baseline.user.replace(
      V6_ATTRIBUTION_INSTRUCTION,
      V7_ATTRIBUTION_INSTRUCTION,
    ),
  };
}
