# Clipper2 WASM Test Suite

This directory contains a standalone test harness and visualization interface for the [Clipper2 WebAssembly](https://github.com/ErikSom/Clipper2-WASM) syntax used for EasyTrace5000 integration.

It serves as a development sandbox to verify boolean operations, offsetting, point-in-polygon checks, and the custom arc reconstruction algorithms before they are integrated into the main application.

## 🚀 Usage

**Live web-page:** [cam.eltryus.design/clipper2/](https://cam.eltryus.design/clipper2/)

This page is self-contained. To run the tests:

1. Serve the root directory of the repository (e.g., using VS Code Live Server).
2. Navigate to `/clipper2/index.html` in your browser.
3. Use the UI to run specific geometry tests (Boolean, Offsetting, Minkoswki Sums, etc.).

## 📂 File Structure

* **Core Logic:** `clipper2-core.js`, `clipper2-tests.js`
* **Visualization:** `clipper2-rendering.js`, `clipper2-ui.js`
* **Geometry Helpers:** `clipper2-geometry.js`, `clipper2-properties.js`
* **WASM Libraries:** `clipper2z.js` (Glue code), `clipper2z.wasm` (Binary)

## ⚖️ License & Credits

**Test Suite Logic & UI**
Copyright © 2026 Eltryus - Ricardo Marques.
Licensed under the [GNU Affero General Public License v3.0](../LICENSE).

**Underlying Libraries**
This test suite relies on external open-source libraries which are distributed under their own licenses:

* **Clipper2 Geometry Library**
  * Copyright © 2010-2026 Angus Johnson
  * License: [Boost Software License 1.0](LICENSE)
  * [GitHub Repository](https://github.com/AngusJohnson/Clipper2)

* **Clipper2-WASM Port**
  * Copyright © 2026 Erik Som
  * License: [Boost Software License 1.0](LICENSE)
  * [GitHub Repository](https://github.com/ErikSom/Clipper2-WASM)