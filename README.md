# EasyTrace5000 - Advanced Workspace

![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg) ![Status: Active](https://img.shields.io/badge/status-active-success.svg) ![Tech: VanillaJS](https://img.shields.io/badge/tech-Vanilla_JS-yellow.svg) ![Tech: WebAssembly](https://img.shields.io/badge/tech-WebAssembly-blueviolet.svg)

An open-source, browser-based CAM tool for generating G-code from PCB manufacturing files. Featuring an interactive 2D Canvas renderer, high-performance Clipper2 geometry engine with a custom arc-reconstruction system and intelligent toolpath optimization.

![I'll add screenshots when GUI is ready](https://placehold.co/800x420?text=EasyTrace5000\nScreenshot\nPlaceholder)

## Key Features

* **Multi-Operation Workflow**
   A non-destructive workflow for common PCB CAM tasks:
   * **Isolation Routing:** Multi-pass trace isolation.
   * **Drilling:** Smart peck-or-mill strategy selection.
   * **Copper Clearing:** Internal pocketing for large copper areas.
   * **Board Cutouts:** Path generation with optional tab placement.

* **1. Advanced Geometry Engine (Source -> Offset)**
   The first stage converts source files into offset *geometry*.
   * **Analytic Parsing:** Reads Gerber, Excellon, and full SVG paths (including arcs and Béziers) into their native shapes.
   * **Clipper2 Engine:** Uses a WebAssembly-based Clipper2 library for high-performance, robust boolean operations (union, difference).
   * **Arc Reconstruction:** Reconstructs true arcs (G2/G3) from polygonized post Clipper2 data.
   * **Unified Offset Pipeline:** A single pipeline handles both external (isolation) and internal (clearing) multi-pass offsets.
   * **Smart Drill Strategy:** Analyzes drill hole size against tool diameter and generates the required "*offset*" object (either `peck_mark` or `drill_milling_path`).

* **2. Intelligent Toolpath Pipeline (Offset -> G-code)**
   The final export stage converts geometry into optimized machine motion.
   * **Geometry Translation:** Translates offset geometry objects into organized toolpath plans
   * **Machine Processing:** Injects all necessary machine-specific commands:
      * Adds rapids, plunges, and retracts to safe/travel Z-heights.
      * Detects multi-depth passes on the same path to only perform a quick Z-plunge.
      * Manages complex hole/slot entries logic (helix vs plunge)
      * Handles Z-lifts for board tabs during cutout operations.
   * **Toolpath Optimization:** Optionally restructures the toolpath plan object to maximize efficiency:
      * **Staydown Clustering:** Geometrically analyzes paths and groups nearby cuts to minimize Z-axis retractions.
      * **Path Ordering:** Applies a nearest-neighbor algorithm to sort clusters to reduce rapid travel time.


* **3. Multi-Stage Canvas Renderer**
   * **Hardware Accelerated:** Provides smooth panning and zooming.
   * **Multi-Stage Visualization:** Clearly and distinctly renders **Source** (Gerber/SVG), **Offset** (generated paths), and **Preview** (tool-reach simulation) layers.
   * **Smart Drill Rendering:** Visually distinguishes source drill holes, offset-stage peck marks, and final preview simulations with clear, color-coded warnings for oversized tools.

# Tech Stack

* **Frontend:** Vanilla JavaScript (ES6+), HTML5, CSS3
* **Geometry Engine:** [Clipper2](https://github.com/AngusJohnson/Clipper2) via [WebAssembly](https://github.com/ErikSom/Clipper2-WASM/)
* **Rendering:** Custom 2D Canvas-based layer renderer with an overlay system for grids, rulers, and origin points.
* **File Parsing:** Native parsers for Gerber (RS-274X), Excellon, and SVG formats.
* **Toolpath Generation:** A three-stage pipeline (Translate, Optimize, Process) to convert geometry into machine-ready plans.

## File Compatibility

The application has been developer and tested with files generated from **KiCAD** and **EasyEDA**.

* **Gerber:** `.gbr`, `.ger`, `.gtl`, `.gbl`, `.gts`, `.gbs`, `.gko`, `.gm1`
* **Excellon:** `.drl`, `.xln`, `.txt`, `.drill`, `.exc`
* **SVG**

Note: The parser understands all svg data including complex Bézier curves and creates the corresponding Cubic or Quadratic primitives. Bézier primitives are then tessellated by the plotter into line segments, as the geometry engine does not support analytic Bézier offsetting yet.

## Usage

### Quick Start
1. **Load Files:** Drag-and-drop or use "Add Files" button for each operation type
2. **Configure Tool:** Select tool from library or define custom diameter
3. **Generate Offsets:** Set passes, stepover, and click "Generate Offsets"
4. **Preview Toolpath:** Configure depths, feeds, and click "Generate Preview"
5. **Export G-code:** Open Operations Manager, arrange sequence, and export

## The Three-Stage Workflow

The application guides the user through a clear, non-destructive process. Each stage builds on the last, and its visibility can be toggled in the renderer.

### Stage 1: Source (Load Geometry)
* **Action:** Add Gerber, Excellon, or SVG files.
* **Result:** The original source geometry is parsed, analyzed, and displayed in the renderer.
* **You See:** The original trace paths, pads, regions and drill holes.

### Stage 2: Offset (Generate Geometry)
* **Action:** Configure parameters (tool, depth, stepover) and click **"Generate Offsets"** (or "Generate Drill Strategy").
* **Result:** The core runs the **Geometry Engine**.
   * For **Milling** operations, this creates new `offset` primitives using virtually lossless pipelines.
   * For **Drilling** operations, this runs the `_determineDrillStrategy` logic, creating `peck_mark` or `drill_milling_path` primitives based on tool/hole size.
* **You See:** New objects appear in the tree ("Pass 1", "Peck Marks") and are rendered as thin outlines. Drill markings are color coded for cutting tool diameter vs hole size.

### Stage 3: Preview (Simulate Tool Reach)
* **Action:** Click **"Generate Preview"**.
* **Result:** This is a lightweight, *visual-aid* step. It creates `preview` primitives using the `offset` objects but stroked with the tool's diameter.
* **You See:** New objects in the tree and the thin offset lines are replaced by a thick, simulated toolpath, showing you exactly what material will be removed.

---

## G-code Generation & Optimization

The final step is handled in the **Toolpath Manager** modal, which is opened from the "Preview" stage or the main toolbar *after* machine parameters have been set.

This modal is where the *full toolpath pipeline* is executed:

1.  **Arrange & Select:** You can drag-and-drop operations to change their cutting order and check/uncheck which ones to include in the final export.
2.  **Optimize:** You can check the **"Optimize Paths"** box.
3.  **Generate:** Clicking **"Calculate Preview"** or **"Export G-code"** runs the complete pipeline:
      * **Translate:** Offset geometry is converted to `ToolpathPlan` objects.
      * **Optimize (if checked):** `ToolpathOptimizer` re-configures the plans.
      * **Process:** `MachineProcessor` injects rapids, plunges, pecks, helices, and tab-lifts.
      * **Export:** `GCodeGenerator` follows post-processor instructions to convert the machine-ready plan into g-code.

## Project Structure

```
/
├── index.html                          # Main application entry
│
├── config.js                           # Configuration and defaults
│
├── cam-core.js                         # Core application logic
├── cam-ui.js                           # UI controller
├── cam-controller.js                   # Initialization and connection
│
├── css/
│   ├── base.css                        # Foundation styles (reset, variables, etc)
│   ├── canvas.css                      # Canvas-specific rendering styles
│   ├── components.css                  # Reusable UI components (buttons, inputs, etc)
│   ├── layout.css                      # Layout structure (grid, toolbar, etc)
│   └── theme.css                       # Theme system fallback
│
├── themes/
│   ├── theme-loader.js                 # Theme loading and switching utility
│   ├── light.json                      # Light Theme
│   └── dark.json                       # Dark Theme
│
├── coordinate/
│   └── coordinate-system.js            # Coordinate transformations
│
├── ui/
│   ├── ui-tree-manager.js              # Operations tree (left sidebar)
│   ├── ui-property-inspector.js        # Properties panel (right sidebar)
│   ├── ui-controls.js                  # User interaction handlers
│   ├── ui-status-manager.js            # Status bar
│   ├── ui-tooltip.js                   # Tooltip system
│   ├── ui-parameter-manager.js         # Parameter validation
│   ├── ui-modal-manager.js             # Modal boxes
│   └── ui-tool-library.js              # Tool definitions
│
├── geometry/
│   ├── clipper2z.js                    # Clipper2 WASM factory
│   ├── clipper2z.wasm                  # Clipper2 WASM binary
│   ├── geometry-clipper-wrapper.js     # Clipper2 interface
│   ├── geometry-processor.js           # Boolean operations
│   ├── geometry-arc-reconstructor.js   # Custom Clipper2 arc recovery
│   ├── geometry-curve-registry.js      # Curve metadata tracking
│   ├── geometry-offsetter.js           # Path offsetting
│   └── geometry-utils.js               # Utility functions
│
├── parsers/
│   ├── parser-core.js                  # Base parser orchestration
│   ├── parser-gerber.js                # Gerber RS-274X parser
│   ├── parser-excellon.js              # Excellon drill parser
│   ├── parser-svg.js                   # SVG parser
│   ├── parser-plotter.js               # Geometry converter
│   └── primitives.js                   # Geometric primitives
│
├── renderer/
│   ├── renderer-core.js                # 2D Canvas renderer
│   ├── renderer-interaction.js         # Pan/zoom/measure
│   ├── renderer-layer.js               # Layer management
│   ├── renderer-overlay.js             # Grid/rulers/origin
│   └── renderer-primitives.js          # Geometry rendering
│
├── toolpath/
│   ├── toolpath-primitives.js          # Toolpath data structures
│   ├── toolpath-geometry-translator.js # Offset to cutting paths
│   ├── toolpath-machine-processor.js   # Machine motion injection
│   └── toolpath-optimizer.js           # Path ordering/optimization
│
├── export/
│   ├── gcode-generator.js              # G-code generation
│   ├── svg-exporter.js                 # SVG export
│   └── processors/                     # Post-processor modules
│       ├── base-processor.js
│       └── grbl-processor.js
│
├── examples/
│   ├── example1/                       # Sample PCB files
│   └── LineTest.svg                    # Precision test pattern
│
└── clipper2/                           # Clipper2 test page
```

## Running Locally

1. Clone the repository:
   ```bash
   git clone https://github.com/RicardoJCMarques/Eltryus_CAM.git
   ```

2. No build step required - pure client-side application

3. Recommended: Use VS Code with [Five Server](https://github.com/yandeu/five-server-vscode) extension
   - Right-click `index.html` → "Open with Five Server"
   - Browser should open at `http://127.0.0.1:5500/`

4. Optional: Create `fiveserver.config.js` for custom server configuration

## Testing & Debugging

```javascript
// Browser console commands
window.pcbcam.getStats()                // Display pipeline statistics
window.enablePCBDebug()                 // Enable verbose logging // Integrated into the UI
window.getReconstructionRegistry()      // Inspect arc metadata
```

## Known Issues & Limitations

**Current Limitations:**
* **Metric Units:** Milimeters only. System is technically unit agnostic but it's base 10. A new module that manages unit states and conversions must be made from scratch.
* **Bézier Offsetting:** While Bézier curves from SVGs *are* parsed analytically, they are tessellated (converted to line segments) by the plotter before offsetting. True analytic offsetting of Béziers is not yet supported.
* **Tool Changes:** The application does not currently generate tool change commands (M6). Operations using different tools must be exported as separate G-code files.
* **UI:** Small screen/mobile support is incomplete.

**Known Bugs:**
* **Hole Rendering:** Parsed objects with holes (likely from an svg) are processed correctly by the geometry engine, but may not render correctly in the 2D canvas (e.g., holes may appear as regular filled polygon).
* **Peck Marks Post-Preview:** After Preview geometry is rendered, peck marks are stuck as filled *preview* circle primitives.
* **Offsetting of corners:** Depending on distance between an internal corner (concave) and external corner (convex) the analytic offsetting engine may cause artifacts between the external rounded joint's arc and the internal side path.

## Roadmap

- Responsive design for smaller screens
- Tool library import/export
- Theme import/export
- 3D G-code preview/simulation
- Laser files (isolation, soldermasks, etc)
- Automatic tool change (M6) support
- Improved toolpath optimization
- Multi-sided PCB support
- Cloud project storage

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