# Third-party dependency license audit

Audit date: 2026-09-02

Scope: `backend`, `dashboard`, and `extension` npm dependency trees.

## Deliverables

- `production-dependencies.csv`: deduplicated package-version inventory for production dependency trees, with every consuming folder listed.
- `all-dependencies.csv`: deduplicated inventory including development/build dependencies.

## Production findings

- 741 unique package-version records were found across the three production trees.
- Most dependencies use permissive licenses, but their copyright and license notices must still accompany distributions where their license requires it.
- `@img/sharp-libvips-darwin-x64@1.0.4` is LGPL-3.0-or-later and enters the backend through `sharp@0.33.5`. Treat the platform-specific libvips binary used in deployment equivalently.
- `web-push@3.6.7` is MPL-2.0 and is a direct backend dependency.
- `webextension-polyfill@0.12.0` is MPL-2.0 and is a direct dependency of both dashboard and extension.
- `argparse@2.0.1` uses the Python-2.0 license.
- `expand-template@2.0.3` offers an MIT-or-WTFPL choice; use the MIT option. It enters extension through `pdfjs-dist > canvas > prebuild-install`.
- `veristrata-dashboard@0.0.0` is marked `UNLICENSED`; this is the first-party application, not undisclosed third-party IP.

## Development-only findings

- `pngquant-bin@6.0.1` is GPL-3.0+ but appears only in the extension development/build tree. Do not redistribute the build tool or its binary with the extension unless GPL compliance is handled.
- `node-forge@1.3.1` offers BSD-3-Clause or GPL-2.0; select and disclose BSD-3-Clause if it is ever redistributed as part of the development toolchain.
- `caniuse-lite` is CC-BY-4.0 and appears in development tooling.

## Release action

Generate a Third-Party Notices artifact from `production-dependencies.csv` that includes the full license text and copyright notice for each distributed package. Preserve Apache `NOTICE` content where supplied. For MPL components, preserve notices and make modified MPL-covered source files available. For the LGPL libvips binary, include the LGPL text and satisfy the applicable relinking/reverse-engineering and corresponding-source requirements.

This is an engineering inventory, not legal advice. Actual disclosure scope depends on the contents of each deployed server image and bundled browser artifact.
