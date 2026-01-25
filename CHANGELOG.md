# Changelog

All notable changes to the **EasyTrace5000** project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.3] - 2026-01-25

### Added
- **Added Help Modal:** Pressing F1 or clicking the link in the Welcome modal opens the Help modal with starter tips and keyboard shortcuts/navigation.
- **Better ARIA Tags:** Improved Accessible Rich Internet Applications tags related to geometry object hierarchy and interaction.
- **Upgraded Gerber Parsing:** The Gerber Parsing Module can now handle more MACRO commands.
- **Improved HTML:** Fixed index.html following [W3's Validator](https://validator.w3.org/).
- **More SEO Changes**

## [1.0.2] - 2026-01-22

### Added
- **Improved UI Responsivenes:** Made the UI values more flexible. Workspace should be more usable even with smaller screens. (Not aiming at narrow smartphones, yet)
- **Fixed Marlin Post-processor:** Marlin has been flagged as Not supporting modal commands.
- **Added ARIA Tags:** Initial implementation of Accessible Rich Internet Applications tag management.
- **Fixed/Expanded Keyboard Shortcuts/Navigation:** See [Accessibility Documentation](docs/ACCESSIBILITY.md) for more details.
- **Added Favicons**
- **SEO Changes**

## [1.0.1] - 2026-01-16

### Added
- **Mirroring:** Added support for Horizontal (X) and Vertical (Y) board mirroring. Toggles under board rotation inside the Board Placement section.
- **Coordinate System:** Upgraded the transformation engine to support complex combinations of rotation and mirroring.

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