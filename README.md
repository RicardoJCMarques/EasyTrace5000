# EasyTrace5000 - Advanced Workspace

![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg) ![Status: Active](https://img.shields.io/badge/status-active-success.svg) ![Tech: VanillaJS](https://img.shields.io/badge/tech-Vanilla_JS-yellow.svg) ![Tech: WebAssembly](https://img.shields.io/badge/tech-WebAssembly-blueviolet.svg)

An open-source, browser based CAM tool for generating G-code from PCB manufacturing files. Featuring an interactive WebGL renderer and a high-performance Clipper2 based geometry engine.

![I'll add screenshots when GUI is ready](https://placehold.co/800x420?text=EasyTrace5000\nScreenshot\nPlaceholder)

## Key Features

* **Multi-Operation Support:** Process files for Isolation, Drilling, Copper Clearing, and Board Cutouts.
* **Stage-Based Workflow:** A clear, step-by-step process for each operation:
    1. **Source:** Load and view the original geometry.
    2. **Offset:** Generate offset paths based on tool parameters.
    3. **Preview:** Visualize a tool reach simulation before generating G-code.
* **Advanced Geometry Processing:**
    * **Efficient boolean pipeline:** Boolean operations handled by the Clipper2 library (WASM).
    * **Unified Offset Pipeline:** Simplified offset pipeline that generates external and internal multi-pass isolation and clearing paths.
    * **Custom Arc Reconstruction:** Reconstructs true arcs (`G2`/`G3`) from segmented Clipper2 data for efficient G-code and machine motion.
* **Interactive 2D Renderer:**
    * High-performance WebGL-based renderer for smooth panning and zooming.
    * Layer visibility controls, wireframe mode, and measurement grids.
* **Flexible Tool Management:** A configurable tool library allows defining and selecting tools for different operations.
* **Detailed Parameter Control:** Fine-tune every aspect of the job, including cut depth, step-over, feed rates, and multi-pass settings.

## Tech Stack

* **Frontend:** Vanilla JavaScript (ES6+), HTML5, CSS3
* **Geometry Engine:** [Clipper2](https://github.com/AngusJohnson/Clipper2) via [WebAssembly](https://github.com/ErikSom/Clipper2-WASM/) for high-performance polygon operations.
* **Rendering:** Custom WebGL-based 2D layer renderer. (Possible 3d g-code viewer, one day)
* **File Parsing:** Custom parsers for Gerber (RS-274X) and Excellon formats. SVG comming Soon™ (No Béziers in the near future).

## Compatibility

* **KiCAD**
* **EasyEDA**
* **TDB**

## Usage

1.  **Load Files:** Use the "Add Files" buttons in the "Operations" panel or the drop-down areas from Actions -> Add Files to load your Gerber and Excellon files into the desired operation.
3.  **Configure Parameters:** Click on a file in the tree view to select it. Parameters will appear in the right sidebar.
4.  **Generate Offsets:** Edit X&Y parameters and click the action button ("Generate Offsets")
5.  **Generate Preview:** Edit Z parameters and click the action button ("Generate Preview")
6.  **Generate G-Code:** Edit machine parameters and click the action button ("Export G-Code")

Note: While the UI allows defining multiple tools, automatic tool-changing G-code (M6) is not yet implemented. You can export operations that use the same tool into a single file.

## Project Structure

The project follows a modular structure. The loading order in `index.html` reflects dependency hierarchy.

```
/
├── index.html                          # Main application entry point
├── cam.css                             # All application styles
├── config.js                           # Default values, configurations, small aux methods
│
├── cam-core.js                         # Core application logic
├── cam-ui.js                           # Main UI controller, orchestrates UI components
├── cam-controller.js                   # Initializes and connects core and UI
│
├── coortinate/
│   └── coordinate-system.js            # Manages coordinate translations / rotations
│
├── ui/
│   ├── ui-tree-manager.js              # Manages the operations tree view (left sidebar)
│   ├── ui-property-inspector.js        # Manages the properties panel (right sidebar)
│   ├── ui-controls.js                  # Manages the user interactivity
│   ├── ui-status-manager.js            # Manages the status bar
│   ├── ui-tooltip.js                   # Manages all UI tooltips
│   ├── ui-parameter-manager.js         # Manages parameter strings and validation
│   ├── ui-tool-library.js              # Manages tool definitions and tool selection functionality
│   └── ui-visibility-panel.js          # Manages advanced visibility toggles
│
├── geometry/
│   ├── clipper2z.js                    # Clipper2 WASM factory
│   ├── clipper2z.wasm                  # Clipper2 WASM library
│   ├── geometry-clipper-wrapper.js     # Clipper2 intermediary wrapper
│   ├── geometry-processor.js           # Processes geometric boolean operations
│   ├── geometry-arc-reconstructor.js   # Custom system to recover arcs after Clipper2 booleans
│   ├── geometry-curve-registry.js      # Manages the Curve Registry for arc-reconstruction
│   ├── geometry-offsetter.js           # Handles geometry offsetting
│   └── geometry-utils.js               # Contains general auxiliary functions
│
├── parsers/
│   ├── parser-core.js                  # Manages the parsing system
│   ├── parser-gerber.js                # Gerber parsing module (RS-274X)
│   ├── parser-excellon.js              # Excellon parsing module (drill)
│   ├── parser-svg.js                   # SVG parsing module (Soon™)(needs more testing and no Beziers)
│   ├── parser-plotter.js               # Converts parsed data into geometric primitives
│   └── primitives.js                   # Defines geometric primitives (Path, Circle, etc)
│
├── renderer/
│   ├── renderer-core.js                # Coordinates canvas, view and layer states
│   ├── renderer-interaction.js         # Manages canvas user interactions
│   ├── renderer-layer.js               # Manages layers
│   ├── renderer-overlay.js             # Handles grid, rulers, origin, scale indicator, etc
│   └── renderer-primitives.js          # Dedicated geometry object renderer
│
├── examples/
│   ├── example1/
│   │   ├── isolation.gbr
│   │   ├── clear.gbr
│   │   ├── cutout.gbr
│   │   └── drill.drl
│   └── LineTest.svg                    # CNC/Cutting tool precision test geometry
│
├── export/
│    ├── exporter-g-code                # Logic for exporting g-code following set parameters
│    └── exporter-svg.js                # Logic for exporting the current view as an SVG
│
└── clipper2/                           # Clipper2 WASM syntax test page

```

## Running Locally

1. Clone the repository: git clone [https://github.com/RicardoJCMarques/Eltryus_CAM.git](https://github.com/RicardoJCMarques/Eltryus_CAM.git)
2. This project has no build step. We recommend using VS Code with the [Five Server](https://github.com/yandeu/five-server-vscode) extension for live-reloading.
3. Right-click index.html and select "Open with Five Server". Your browser should open a tab to the application (http://127.0.0.1:5500/).
4.  It's possible to create a fiveserver.config.js file for custom Fiver Server setups.

## Testing
```javascript
// Browser console
window.pcbcam.getStats()                // Show pipeline stats
window.enablePCBDebug()                 // Enable debug logging
window.getReconstructionRegistry()      // Inspect arc metadata
```

## Next Steps

- Make the page usable in smaller and <sub>smaller</sub> screens.
- Simplified pipelines for laser engraving isolation.
- Tool changing support.
- Tool library and config (themes, etc) import
- Bezier primitives and arc fitting based reconstruction support.

## ❤️ Support the Project

This is a free, open-source project. If you find it useful, please consider supporting its development!

[**>> Buy Me a Coffee <<**](https://ko-fi.com/eltryus)

## License 

This project is licensed under the GNU Affero General Public License v3.0.

This means the software is free to use, modify, and distribute. However, if you run a modified version on a network server and allow users to interact with it, you must also make the modified source code openly available.

For the full license text, see the [LICENSE](./LICENSE) file.

**Key points:**
- ✅ Free to use, including commercial applications
- ✅ Modify and distribute as needed
- ✅ Must keep source open (GPL v3)
- ❌ Cannot create closed-source derivatives

## 🙏 Acknowledgments

- Angus Johnson for Clipper2 and Erik Sombroek for the WASM compilation 
- Open-source and Fab Lab / Makerspace community
- Krisjanis and Marcela for oustanding contributions to naming this thing

---

**Status**: Active Development | **Version**: 1.0 | **Platform**: Client-side Web