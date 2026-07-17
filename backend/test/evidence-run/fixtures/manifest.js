export const ER1_CF1_FIXTURES = Object.freeze([
  ["CF1-F01", "cf1pkg_019f6502-21ab-730f-8cf2-4503976f9f58", "63d42e68f91ca419ad79b0a085dd62793f9b543052ce067637fb5770e61096d9", "cf1run_019f6500-d609-74c1-9be1-a27071fc8e65", 8],
  ["CF1-F02", "cf1pkg_019f6503-4a29-722f-a73f-96e472decf9c", "a22e1ec26ce25f914c7bf109fe455770c98a15305594601e8c34d0b59c8cc470", "cf1run_019f6502-5697-725d-b13a-2d28403b55a1", 8],
  ["CF1-F03", "cf1pkg_019f6508-a498-75ed-b1d4-d0c225991eff", "9efa734a86d9e9648472476cdcf07d79136adf6519f605804368c45968946572", "cf1run_019f6508-3e10-70ee-9e02-4fc89791fccd", 8],
  ["CF1-F04", "cf1pkg_019f650c-2295-758b-b43f-820c5bcccff1", "373083dc78915dd2e5760eb5050b74f4029d4c19fac24fa144cd4a2fe9689f5b", "cf1run_019f650b-34e8-7337-9152-f397cfd34aef", 8],
  ["CF1-F05", "cf1pkg_019f650d-f794-70cb-ac7d-2b4607433cb5", "64f66d5078af1b3714d26fc499fd22537e4870be9ccdaf220c23ed144119a71c", "cf1run_019f650d-30eb-7493-b0a9-a8a2f40c8977", 8],
  ["CF1-F06", "cf1pkg_019f650e-d4c3-76a8-b4d7-3a7dec06ff12", "436f38811ff0c358ee5edaf55d38aa43071f21a3fc489c29411fdaecfb02d592", "cf1run_019f650e-0a49-703a-8352-910c40bacd15", 8],
  ["CF1-F07", "cf1pkg_019f650f-e008-729e-b8cb-2e398d7bac96", "9883a2ea58db5e713c96574011e26ec61c0a8934222436f1b2d6cc01e8045cc7", "cf1run_019f650e-ef6d-77fa-b379-58719febc58b", 8],
  ["CF1-F08", "cf1pkg_019f6511-114c-76fa-bb27-d78a3642cc9a", "b64edec2b5e6cabf83ec176c7afc37474f4cc91287daee25d6c3f9a00294aff3", "cf1run_019f6510-b100-746f-835e-a8a32fe7cde6", 3],
].map(([fixtureId, packageId, packageHash, runDir, targetCount]) => Object.freeze({
  fixtureId, packageId, packageHash, targetCount,
  relativePath: `artifacts/claim-foundry/agent-runs/eight-fixture-compact-20260715/${fixtureId}/${runDir}/final_cf1_package.json`,
})));
