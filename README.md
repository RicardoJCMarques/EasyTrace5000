# EasyTrace5000 - Advanced Workspace

![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg) ![Status: Active](https://img.shields.io/badge/status-active-success.svg) ![Tech: VanillaJS](https://img.shields.io/badge/tech-Vanilla_JS-yellow.svg) ![Tech: WebAssembly](https://img.shields.io/badge/tech-WebAssembly-blueviolet.svg)

An open-source, browser-based CAM tool for generating G-code from PCB manufacturing files. Featuring an interactive 2D Canvas renderer, high-performance Clipper2 geometry engine with a custom arc-reconstruction system and intelligent toolpath optimization.

![I'll add screenshots when GUI is ready](https://placehold.co/800x420?text=EasyTrace5000\nScreenshot\nPlaceholder)

## Key Features

* **Multi-Operation Workflow**
   A non-destructive workflow for common PCB CAM tasks:
   * **Isolation Routing:** Multi-pass trace isolation with external offsets.
   * **Drilling:** Smart peck-or-mill strategy selection with slot support.
   * **Copper Clearing:** Internal pocketing for large copper areas.
   * **Board Cutouts:** Path generation with optional tab placement.

* **1. Advanced Geometry Engine**
   The first stage converts source files into offset *geometry*.
   * **Analytic Parsing:** Reads Gerber, Excellon and full SVG paths (including arcs and Béziers) and converts to geometry objects.
   * **Clipper2 Engine:** Uses the WebAssembly compilation of Clipper2 for high-performance boolean operations.
   * **Arc Reconstruction:** Reconstructs true arcs (G2/G3) from polygonized post-Clipper2 data.
   * **Unified Offset Pipeline:** A single pipeline handles both external (isolation) and internal (clearing) multi-pass offsets.
   * **Smart Drill Strategy:** Analyzes drill hole/slot size against tool diameter and generates the required operational object.

* **2. Intelligent Toolpath Pipeline**
   The final export stage converts geometry into optimized machine motion.
   * **Geometry Translation:** Translates offset geometry objects into organized toolpath plans with proper entry/exit points.
   * **Machine Processing:** Injects all necessary machine-specific commands:
      * Adds rapids, plunges, and retracts to safe/travel Z-heights.
      * Detects multi-depth passes on the same path to perform quick Z-plunges without retract.
      * Manages complex hole/slot entries (helix or plunge).
      * Handles Z-lifts for board tabs during cutout operations.
   * **Toolpath Optimization:** Optionally restructures the toolpath plan to maximize efficiency:
      * **Staydown Clustering:** Geometrically analyzes paths and groups nearby cuts to minimize Z-axis retractions.
      * **Path Ordering:** Applies a nearest-neighbor algorithm to sort clusters and reduce rapid travel time.
      * **Segment Simplification:** Removes collinear points with angle-aware tolerance.

* **3. Multi-Stage Canvas Renderer**
   * **Render optimization:** Provides smooth panning and zooming with batching, level of detail and viewport culling.
   * **Multi-Stage Visualization:** Clearly and distinctly renders **Source** (Gerber/SVG), **Offset** (generated paths), and **Preview** (tool-reach simulation) layers. Plus optional Debug features.
   * **Smart Drill Rendering:** Visually distinguishes source drill holes/slots, offset-stage peck marks, and final preview simulations with color-coded warnings for tool relation (exact/undersized/oversized).

# Tech Stack

* **Frontend:** Vanilla JavaScript (ES6+), HTML5, CSS3
* **Geometry Engine:** [Clipper2](https://github.com/AngusJohnson/Clipper2) via [WebAssembly](https://github.com/ErikSom/Clipper2-WASM/)
* **Rendering:** Custom 2D Canvas-based layer renderer with an overlay system for grids, rulers, and origin points.
* **File Parsing:** Native parsers for Gerber (RS-274X), Excellon and SVG formats.
* **Toolpath Generation:** A three-stage pipeline (Translate, Optimize, Process) to convert geometry into machine-ready plans.
* **Post-Processors:** GRBL, Roland RML (Experimental), GrblHAL (Experimental), Marlin (Experimental), LinuxCNC (Experimental), Mach3 (Experimental).

## File Compatibility

The application has been developed and tested with files generated from **KiCAD** and **EasyEDA**.

* **Gerber:** `.gbr`, `.ger`, `.gtl`, `.gbl`, `.gts`, `.gbs`, `.gko`, `.gm1`
* **Excellon:** `.drl`, `.xln`, `.txt`, `.drill`, `.exc`
* **SVG**

Note: The parser understands all SVG data including complex Bézier curves and creates the corresponding Cubic or Quadratic primitives. Bézier primitives are then interpolated by the plotter into line segments, as the geometry engine does not support analytic Bézier offsetting yet.

## Usage

### Quick Start
1. **Load Files:** Drag-and-drop or use "Add Files" button for each operation type
2. **Configure Tool:** Select tool from library or define custom diameter
3. **Generate Offsets:** Set passes, stepover, and click "Generate Offsets"
4. **Preview Toolpath:** Configure depths, feeds, and click "Generate Preview"
5. **Export G-code:** Open Operations Manager, arrange sequence, and export

## The Workflow

The application guides the user through a clear, non-destructive process. Each stage builds on the last, and its visibility can be toggled in the renderer.

### Stage 1: Source (Load Geometry)
* **Action:** Add Gerber, Excellon or SVG files to the respective operation.
* **Result:** The original source geometry is parsed, analyzed and displayed in the renderer.
* **You See:** The original trace paths, pads, regions, drill holes and slots.

### Stage 1.5: Coordinates and Machine settings
* **Action:** Double check origin placement, rotation and base Machine parameters.
* **Result:** Sets geometry origin and all machine settings that will affect toolpaths.
* **You See:** Origin and rulers will adapt if origin is moved in relation to the board.

### Stage 2: Offset (Generate Geometry)
* **Action:** Configure parameters (tool, depth, stepover) and click **"Generate Offsets"** (or "Generate Drill Strategy").
* **Result:** The core runs the **Geometry Engine**.
   * For **Milling** operations, this creates new `offset` primitives using virtually lossless pipelines.
   * For **Drilling** operations, this runs the drill strategy logic, creating Peck, Drill Milling, or Centerline primitives based on tool/hole size comparison.
* **You See:** New objects appear in the tree ("Pass 1", "Peck Marks", "Milling Paths") and are rendered as thin red outlines. Drill markings are color-coded: green (exact fit), yellow (undersized tool), red (oversized tool).

### Stage 3: Preview (Simulate Tool Reach)
* **Action:** Configure parameters (feed rate, plunge rate, spindle rpms) and click **Generate Preview**.
* **Result:** This is a lightweight, *visual-aid* step. It creates `preview` primitives using the `offset` objects but stroked with the tool's diameter.
* **You See:** New objects in the tree that render as simulated toolpaths the width of the tool, showing you what material will be removed. (Automatically hides offset geometry objects)

### Stage 4: Gcode Export
* **Action:** Click **Operations & G-Code**, check operation order and export options. Click Calculate Toolpaths and then either copy g-code from the text box or Export as a file.
* **Result:** Calculating Toolpaths translates the geometry objects into toolpath plan objects, optionally optimizes them and converts them to final machine ready code.
* **You See:** G-Code Preview text box will become populated by the g-code and clicking **Export G-Code** will create a file for the browser to save/download.

---

## Project Structure

```
/
├── index.html                            # Main application entry
│
├── config.js                             # Configuration and defaults
│
├── cam-core.js                           # Core application logic
├── cam-ui.js                             # UI controller
├── cam-controller.js                     # Initialization and connection
│
├── css/
│   ├── base.css                          # Foundation styles (reset, variables, etc)
│   ├── canvas.css                        # Canvas-specific rendering styles
│   ├── components.css                    # Reusable UI components (buttons, inputs, etc)
│   ├── layout.css                        # Layout structure (grid, toolbar, etc)
│   └── theme.css                         # Theme system fallback
│
├── themes/
│   ├── theme-loader.js                   # Theme loading and switching utility
│   ├── light.json                        # Light Theme
│   └── dark.json                         # Dark Theme
│
├── utils/
│   ├── unit-converter.js                 # Rudimentary unit conversion system (only SVG parsing currently)
│   ├── svg-exporter.js                   # SVG export
│   └── coordinate-system.js              # Coordinate transformations
│
├── ui/
│   ├── ui-nav-tree-panel.js              # Operations tree (left sidebar)
│   ├── ui-operation-panel.js             # Properties panel (right sidebar)
│   ├── ui-parameter-manager.js           # Parameter validation
│   ├── ui-controls.js                    # User interaction handlers
│   ├── ui-status-manager.js              # Status bar and log history manager
│   ├── ui-tooltip.js                     # Tooltip system
│   ├── ui-modal-manager.js               # Modal boxes
│   └── ui-tool-library.js                # Tool definitions
│
├── language/
│   ├── language-manager.js               # Rudimentary multi-language system
│   └── en.json                           # English text strings
│
├── geometry/
│   ├── clipper2z.js                      # Clipper2 WASM factory
│   ├── clipper2z.wasm                    # Clipper2 WASM binary
│   ├── geometry-clipper-wrapper.js       # Clipper2 interface
│   ├── geometry-processor.js             # Boolean operations
│   ├── geometry-arc-reconstructor.js     # Post Clipper2 arc recovery
│   ├── geometry-curve-registry.js        # Curve metadata tracking
│   ├── geometry-offsetter.js             # Path offsetting
│   └── geometry-utils.js                 # Geometry accessory functions
│
├── parsers/
│   ├── parser-core.js                    # Base parser orchestration
│   ├── parser-gerber.js                  # Gerber RS-274X parser
│   ├── parser-excellon.js                # Excellon drill parser
│   ├── parser-svg.js                     # SVG parser
│   ├── parser-plotter.js                 # Geometry converter
│   └── primitives.js                     # Geometric data-structures
│
├── renderer/
│   ├── renderer-core.js                  # 2D Canvas renderer
│   ├── renderer-interaction.js           # Pan/zoom/measure
│   ├── renderer-layer.js                 # Layer management
│   ├── renderer-overlay.js               # Grid/rulers/origin
│   └── renderer-primitives.js            # Geometry rendering
│
├── toolpath/
│   ├── toolpath-primitives.js            # Toolpath data structures
│   ├── toolpath-geometry-translator.js   # Offset to cutting paths
│   ├── toolpath-machine-processor.js     # Machine motion injection
│   ├── toolpath-optimizer.js             # Optimization algorithms
│   └── toolpath-tab-planner.js           # Cutout tab placement
│
├── gcode/
│   ├── gcode-generator.js                # G-code generation
│   └── processors/                       # Post-processor modules
│       ├── base-processor.js
│       ├── grbl-processor.js
│       ├── grblHAL-processor.js
│       ├── linuxcnc-processor.js
│       ├── mach3-processor.js
│       ├── marlin-processor.js
│       └── roland-processor.js           # Independent RML module
│
├── examples/
│   ├── example1/                         # Sample PCB files
│   └── LineTest.svg                      # Precision test pattern
│
├── doc/
│   └── index.html                        # Documentation - Tutorial
│
└── clipper2/                             # Clipper2 test page
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
window.enablePCBDebug()                 // Enable verbose logging - Toggle button in Advanced Visualization menu
window.pcbcam.getStats()                // Display pipeline statistics
window.getReconstructionRegistry()      // Inspect arc metadata from curve registry
```

## Known Issues & Limitations

**Current Limitations:**
* **Post-Processors:** Consider all non-grbl post-processors as experimental and to be used with caution until further notice.
* **Metric Units:** Millimeters only. System is technically unit agnostic but base 10. A unit conversion module is planned.
* **Bézier Offsetting:** While Bézier curves from SVGs are parsed analytically, they are interpolated (converted to line segments) by the plotter. True analytic offsetting and booleans of Béziers is not yet supported.
* **Tool Changes:** The application does not currently generate tool change commands (M6). Operations using different tools must be exported as separate G-code files.
* **UI:** Small screen/mobile support is incomplete.

**Known Bugs:**
* **Offsetting of corners:** Depending on distance between an internal corner (concave) and external corner (convex) the analytic offsetting engine may cause artifacts between the external rounded joint's arc and the internal side path.

## Roadmap

- Unit conversion system
- Responsive design for smaller screens
- Tool library import/export
- Theme import/export
- Multi-lingual UI
- Laser compatible files (isolation, soldermasks, etc)
- Automatic tool change (M6) support
- Improved toolpath optimization
- 3D G-code preview/simulation
- Multi-sided PCB support
- Service Worker for offline caching

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
- Krisjanis and Marcela for outstanding contributions to naming this thing

---

**Status**: Active Development | **Version**: 1.0 | **Platform**: Client-side Web