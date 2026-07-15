import test from "node:test";
import assert from "node:assert/strict";
import { detectTextNamedWorkCues } from "../../src/claim-foundry/textNamedWorkCues.js";

test("host detects generic text-visible citation and named-document cues", () => {
  const works = detectTextNamedWorkCues([
    { unitId: "U0001", text: "Wakefield et al15 and other epidemiologic studies 19–24 were discussed." },
    { unitId: "U0002", text: "The Institute of Medicine (IOM)25 convened an Immunization Safety Review Committee of the IOM." },
    { unitId: "U0003", text: "Cases used DSM-IV and the Individuals with Disabilities Education Act." },
  ]);
  assert.deepEqual(works.map((work) => [work.mentionText, work.citationCallout]), [
    ["Wakefield et al", "15"], ["other epidemiologic studies", "19-24"],
    ["The Institute of Medicine (IOM)", "25"],
    ["an Immunization Safety Review Committee of the IOM", null],
    ["DSM-IV", null], ["Individuals with Disabilities Education Act", null],
  ]);
  assert.ok(works.every((work) => work.source === "text_mention" && work.linkResolved === false));
});
