# CF2 extraction baseline locked for evidence work

Baseline ID: `cf2-v6-c30-p12-locked-20260724`

Code commit: `06366d1de3df7635dccfc6070cafa1fd84c0b605`

Configuration:

- Call A: `gpt-4o-mini` Chat;
- Call B: `gpt-4.1-mini`;
- Call C: `gpt-4.1-mini`;
- candidate maximum: 30;
- portfolio maximum: 12;
- candidate failure mode: `quarantine`;
- selection policy: `treatment_fallback`;
- seed: `3724605090`.

This baseline is locked as an extraction input to evidence development, not
declared production-quality. Known failures are preserved rather than hidden:
F02 attribution quarantine, F03 opponent-stance loss, F04/F05 underfill, and
F08 discovery/portfolio collapse.

Live result files and SHA-256:

| Fixture | Result path | SHA-256 |
|---|---|---|
| F01 | `artifacts/claim-foundry/cf2/cf1-f01-v6-c30-p12-current-work-e2e-20260724/result.json` | `0aba36bc93f9dbe71d3e4f5e6635da0f81e0831f57ceca940f63bdddd4e79d6a` |
| F02 | `artifacts/claim-foundry/cf2/cf1-f02-v6-c30-p12-current-work-e2e-20260724/result.json` | `05448791445ef5bd8ddee51c33a597e0e5a8a56c9a7f9c53a31068410f14b0a0` |
| F03 | `artifacts/claim-foundry/cf2/cf1-f03-v6-c30-p12-current-work-e2e-20260724/result.json` | `5ff5db4fe2982041c79901192ec733809ccad30ae82fc3ef3af08dcfa21e62f7` |
| F04 | `artifacts/claim-foundry/cf2/cf1-f04-v6-c30-p12-current-work-e2e-20260724/result.json` | `97992c3bab4ae6d0e28c0397c23224d388346b7749fd27593eb5e6c336ef6442` |
| F05 | `artifacts/claim-foundry/cf2/cf1-f05-v6-c30-p12-locked-e2e-20260724/result.json` | `aed9431d76b38675adb492fafc4fda5fda07287b622b0367f4babc99c60b761a` |
| F06 | `artifacts/claim-foundry/cf2/cf1-f06-v6-c30-p12-locked-e2e-20260724/result.json` | `e1cbc36aa43e6c7e553e2781fb86f19b64ca70cb52583b1b6812020bb2a0dd25` |
| F07 | `artifacts/claim-foundry/cf2/cf1-f07-v6-c30-p12-locked-e2e-20260724/result.json` | `ee26690a41f6953fc5c0df3b79998487669e3c622da9266efb8d75a3f9ff6c20` |
| F08 | `artifacts/claim-foundry/cf2/cf1-f08-v6-c30-p12-locked-e2e-20260724/result.json` | `c2a7b931cc05039576b37aa5756b860610b31de1d872c4fcc0e218982aea57f7` |
| F09 | `artifacts/claim-foundry/cf2/cf1-f09-v6-c30-p12-locked-e2e-20260724/result.json` | `21051fe7aa1ff6c160db599bdd12e1dbe0874d56f19e93603371cd26a13cbd8c` |

The evidence handoff freezes the selected assertion text and all extraction
judgments. Evidence planning may add a disputed proposition, falsifiability
criteria, source strategy, query concepts, and search lanes. It must not rewrite
the assertion, attribution, treatment, effect, transform, or selection outcome.
