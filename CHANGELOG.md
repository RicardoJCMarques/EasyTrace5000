# Changelog

All notable changes to the **EasyTrace5000** project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Placeholder for upcoming features (e.g., Laser pipeline support).

## [1.0.0] - 2026-01-12

### Initial Release
- **Core:** Fully functional CAM processor with support for Gerber (RS-274X), Excellon, and SVG files.
- **UI:** Responsive, browser-based workspace (Vanilla JS) with Dark/Light themes.
- **Geometry:** Integrated Clipper2 WASM engine for polygon offsetting and boolean operations.
- **Workflow:**
    - Isolation Routing (External offsets).
    - Copper Clearing (Pocketing).
    - Smart Drilling (Peck/Mill/Slot detection).
    - Board Cutout (Tab generation).
- **Visualization:** Custom 2D Canvas renderer with support for tens of thousands of primitives.
- **Export:** G-code generation for GRBL, Marlin, and experimental support for LinuxCNC/Mach3.