# EasyTrace5000 — Browser-Based PCB CAM

![Status: v1.4](https://img.shields.io/badge/status-v1.4-green.svg) ![Part of: EasyCAM5000](https://img.shields.io/badge/suite-EasyCAM5000-blue.svg)

EasyTrace5000 converts PCB fabrication files (Gerber, Excellon, SVG) into G-code for CNC milling and precision SVG/PNG for laser processing. It runs entirely in your browser.

Part of the **[EasyCAM5000 Suite](../README.md)** - see the suite README for tech stack, install/serve instructions, post-processor list, and license.

**[→ Open Workspace ←](https://cam.eltryus.design/easytrace5000/)** · **[Documentation](https://cam.eltryus.design/easytrace5000/doc/)** ([CNC](https://cam.eltryus.design/easytrace5000/doc/cnc) · [Laser](https://cam.eltryus.design/easytrace5000/doc/laser) · [Operations](https://cam.eltryus.design/easytrace5000/doc/operations) · [Parameters](https://cam.eltryus.design/easytrace5000/doc/parameters))

## Key Features

* **Multi-Operation Workflow** - a non-destructive flow for common PCB CAM tasks:
  * **Isolation Routing:** multi-pass trace isolation with external offsets.
  * **Drilling:** smart peck-or-mill strategy selection with slot support.
  * **Copper Clearing:** internal pocketing for large copper areas.
  * **Board Cutout:** path generation with optional holding tabs.
  * **Solderpaste Stencil:** aperture files ready to laser/vinyl cut.

* **Advanced Geometry Engine**
  * Analytic parsing of Gerber, Excellon, and full SVG paths (arcs, Béziers) into geometry objects.
  * Board-level rotation and horizontal/vertical mirroring (no per-object transforms yet).
  * Clipper2 (WebAssembly) for high-performance boolean operations.
  * Arc reconstruction (G2/G3) from polygonized post-Clipper2 data.
  * One unified offset pipeline for both external (isolation) and internal (clearing) multi-pass offsets.

* **Optimized Toolpath Pipeline** - translation → optimization (staydown clustering, nearest-neighbor ordering, collinear simplification) → machine processing (rapids/plunges/retracts, multi-depth detection, helix/plunge hole entries, tab Z-lifts).

* **Laser Pipeline (Beta)** - isolation halos around copper cleared via concentric offsets, solid fills, or directional hatch; exports high-DPI PNG or hairline-stroke SVG for LightBurn / EZCAD.

* **Multi-Stage Renderer** - distinct Source / Offset / Preview layers with viewport culling, plus color-coded drill rendering (exact / undersized / oversized).

## File Compatibility

Developed and tested against files from **KiCad** and **EasyEDA**.

* **Gerber:** `.gbr`, `.ger`, `.gtl`, `.gbl`, `.gts`, `.gbs`, `.gko`, `.gm1`
* **Excellon:** `.drl`, `.xln`, `.txt`, `.drill`, `.exc`
* **SVG**

> Exporting Gerber with Protel file extensions lets drag-and-drop auto-assign files to the expected operation. SVG Béziers are parsed analytically but interpolated to line segments before offsetting (no analytic Bézier offsetting yet).

## Workflow

A non-destructive, stage-based process; each stage's visibility toggles in the renderer.

1. **Source:** add Gerber/Excellon/SVG files to their operation.
2. **Board Placement & Machine Settings:** set origin, rotation/mirroring, and machine parameters (these affect all output).
3. **Offset (geometry):** set tool/passes/stepover → *Generate Offsets*.
4. **Preview (strategy):** set depth/feeds → *Generate Preview* (tool-reach simulation). *Laser skips this stage.*
5. **Export:** open the Operations Manager, order operations → *Calculate Toolpaths* → export G-code (or SVG/PNG for laser).

Full walkthroughs: **[CNC Milling Guide](https://cam.eltryus.design/easytrace5000/doc/cnc)** and **[Laser Processing Guide](https://cam.eltryus.design/easytrace5000/doc/laser)**. Per-operation behavior and every parameter are documented in **[Operations](https://cam.eltryus.design/easytrace5000/doc/operations)** and **[Parameters](https://cam.eltryus.design/easytrace5000/doc/parameters)**.