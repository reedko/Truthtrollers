import { buildP1aAssertionPrompt } from "./p1aAssertionPrompt.js";

export const P1A_V6_ASSERT_XMAT = "P1aV6-assert-xmat";
export const buildP1aV6AssertionNoMaterialityPrompt = (input) =>
  buildP1aAssertionPrompt({ ...input, label: "p1a_v6_assert_xmat",
    removeMateriality: true });
