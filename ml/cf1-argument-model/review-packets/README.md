# CF1 Argument Review Packets

Review packets are generated from immutable model-draft annotations. They are reviewer aids, not approved training data.

Generate the current packet from the repository root:

```bash
node ml/cf1-argument-model/tools/generate-review-packet.mjs
```

The generated HTML stores decisions in the browser's local storage. Use **Export review decisions** before moving browsers or machines. The exported JSON is the portable review record.

Do not edit the `argumentDraft.v1.json` files during review. Corrections should first be recorded in the packet and then deliberately applied to the corresponding `annotation-forms/CF1-FXX.annotation.json` file.
