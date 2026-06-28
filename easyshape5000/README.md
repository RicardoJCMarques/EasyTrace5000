# EasyShape5000 — Browser-Based CNC Router CAM

![Status: v1.0](https://img.shields.io/badge/status-v1.0-green.svg) ![Part of: EasyCAM5000](https://img.shields.io/badge/suite-EasyCAM5000-blue.svg)

EasyShape5000 is a browser-based CAM tool for CNC routers. Import an SVG, assign per-shape operations (profile, pocket, drill), and export G-code. It runs entirely in your browser.

Part of the **[EasyCAM5000 Suite](../README.md)** - see the suite README for tech stack, install/serve instructions, post-processor list, and license.

**[→ Launch Application ←](https://cam.eltryus.design/easyshape5000/)** · **[Documentation](https://cam.eltryus.design/easyshape5000/doc/)** ([Workflow](https://cam.eltryus.design/easyshape5000/doc/guide) · [Operations](https://cam.eltryus.design/easyshape5000/doc/operations) · [Parameters](https://cam.eltryus.design/easyshape5000/doc/parameters))

Unlike EasyTrace5000 (one implicit bucket per operation, files added directly), EasyShape5000 builds a **scene graph** from a single SVG and assigns **explicit per-shape operation buckets** - so each shape can be profiled, pocketed, or drilled independently.

## Key Features

### Scene Graph
* Hierarchical tree of groups and shapes imported from SVG.
* Group/ungroup (<kbd>Ctrl+G</kbd> / <kbd>Ctrl+Shift+G</kbd>); per-node lock and visibility.
* Per-shape transforms: translate, rotate, scale, mirror (X/Y independent).
* Full undo/redo for all structural mutations.

### Operations
* **Profile Cut:** outside / inside / on-line contour cutting with nesting detection and optional holding tabs.
* **Pocket Clearing:** concentric inward offsets with configurable stepover; inner shapes become holes automatically.
* **Drilling:** automatic peck-or-mill selection for circles and obround slots.
* **Engraving, Pattern, V-Carve, 3D Relief:** planned (see [Operations](https://cam.eltryus.design/easyshape5000/doc/operations)).

### Canvas Interaction
* Click-select, shift-toggle, ctrl-add, marquee rectangle; alt-click to select leaf shapes inside groups.
* Drag-move with parent-space delta projection (correct inside rotated groups).
* Scroll-wheel zoom at cursor; middle/right-click pan; two-finger pinch zoom.

### Export Pipeline
* Three-stage optimization (translate → staydown clustering + ordering → machine processing).
* Multi-depth passes with configurable entry strategies; holding-tab Z-lifts on profile cuts.

## File Compatibility

* **SVG** - full path spec (lines, arcs, quadratic/cubic Béziers); group hierarchies preserved. Clones and clip paths not yet supported. Béziers are interpolated to line segments before offsetting.
* **STL** - planned for 3D relief operations.

> SVG Béziers are parsed analytically but interpolated to line segments before offsetting (no analytic Bézier offsetting yet).