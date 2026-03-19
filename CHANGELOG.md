# Changelog

All notable changes to the **EasyTrace5000** project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.2] - 2026-XX-XX

### Fixed
- **Offset Laser SVG Reordering:** The old "optimized" grouping was causing localized heat build-up and scorching. Each pass should finish before the next and starting from the smallest geometry.
- **Allow Drill Milling Of Undersized Tool With Plunge Entry:** The hole diameter minus tool size vs tolerance logic was only meant for helixes to avoid too deep and tight awkward helix commands.

### Added
- **Offset Laser SVG Order Flip Toggle** This toggle can flip the order in which geometry is put into the svg in case a software starts processing from the wrong side.
- **Offset Laser SVG Unique Colors Per Layer Toggle** This toggle can enforce individual colors per layer for softwares that process groups from it.

### Changed
- **Hid Number Of Passes/Offset In Drill Operations:** It's now automatically calculated to clear all the geometry and avoid risky central cores that can break end-mills once they get loose.
- **Hardcoded Drill Mill Stepover:** Since it's hidden from users now, it loads a more conservative 40% from config.js.

## [1.1.1] - 2026-03-17

### Added
- **UCCNC Post-Processor:** Extends standard grbl with canned drill cycles, draft tool changing logic, including tool length compensation.
- **More Split File Options:** Upgraded (and fixed) UI and logic to better support spliting operations into individual files and also spit drill files by hole/tool diameter.

### Fixed
- **Only Drill Pecks:** Drill Milling toggle Off state wasn't propagating correctly. Will now allow regular pecks.

## [1.1.0] - 2026-03-16

### Notice
- **Offset Strategy Within Laser Pipeline Has Been Confirmed As Working. Bumping To v1.1.0** Needs more testing until it's considered stable.

### Added
- **Makera Post-Processor:** Equivalent to standard grbl but with M6 T1 preamble. Contains draft tool-changing logic.
- **Heat Buildup Mitigation:** Initial draft of algorithm for geometry reordering and shuffling to minimize laser focusing too much in small localized areas.

### Fixed
- **Copper Pour Regions:** KiCAD and Fusion/Eagle copper pours should now interact correctly with all geometry. (EasyEDA pours TBD.)
- **Export G-code In Inches:** If a user selects G20 in the UI, the output files are scaled correctly to match now.
- **SVG Parsing:** Module now understands that l and m mean relative coordinates while L and M mean absolute coordinates. Plus extra improvements.
- **Gerber Parsing:** Module propagates geometry units and scale more thoroughly.
- **Minor Optimizations**

### Changed
- **Post-Processor Refactor:** Post-processor modules are not self-contained. They now store relevant defaults, profiles and everything they need so adding and managing modules gets more predictable.
- **Partial Cleanup Of Config.js**

### Deprecated
- **utils/unit-converter.js:** Was mostly useless so code was updated to remove it completely.

- **Known Bugs:** Canvas viewport culling doesn't update correctly when board is rotated. No logic to close opened cutout polygons.

## [1.0.9] - 2026-03-11

### Fixed
- **Winding Enforcement:** Winding is now set at the source to avoid having to check and fix it everywhere else.
- **Further Optimizations:** Removed useless winding checks and enforcements through-out.

### Changed
- **Spun Off Analytic Offsetting:** Analytic offsets has been stripped into a geometry-analytic and geometry-utils-math modules. Build.js ignores them during deployment.
- **Optimized Laser SVG File Size:** Moved to relative commands and stripped unnecessary leading and trailing 0's.

- **Known Bugs:** Some KiCAD copper pour regions aren't interacting with other geometry as expected.

## [1.0.8] - 2026-03-07

### Notice
- **Changes to the offset pipeline made everything slightly more accurate but slower, optimization to come**

### Added
- **Copper Pour Regions:** KiCAD and Fusion Copper Pour regions are now correctly parsed, plotted and processed in Copper Isolation Operations (Copper Clear works but is even slower).
- **New Tiny/Noisy/Collapsed Arc Safeguards:** More protections against small arcs with a tendency to collapse on themselfes, plus less random unnecessarily small arcs.

### Fixed
- **Arc Definitions in Laser SVGs:** Offset Strategy Arcs in exported Laser SVGs will come out right now.
- **Clipper Wrapper and Arc Reconstruction Optimizations:** Older modules - newish logic.

### Changed
- **Removed Analytic Offsets:** Analytic offsets will be developed independently from the live tool. Clipper2 deals better with self-intersection artifacts, for now.
- **Another Attempt At SEO**

## [1.0.7] - 2026-03-02

### Added
- **1st Draft of Laser Pipeline:** All Laser operations are now available for testing. The automated Hybrid (Laser+CNC) pipeline is locked (or just not finished yet depending on how you look at it).
- **Source file Highlight:** Added small onboarding highlight animation on a timer to guide new users into triggering the workflow UI changes.

### Fixed
- **Boolean Add/Diff Arc Data Flaws:** Arc data should now be more consistently passed through Clipper2 Wrapper functions.

### Changed
- **Moved EasyTrace5000 out of Root:** Now the application itself is accessible through the [easytrace5000/](https://cam.eltryus.design/easytrace5000/) folder to try and appease crawler bots and get the subdomain listed again.
- **File Extensions are set automatically:** The User only needs to input the file name and the pipeline handles the file extensions.

## [1.0.6] - 2026-02-12

### Fixed
- **Full Refactor of Roland PostProcessor:** Complete rework of the RML-1 post-processor module. Should now have all required nuance to work with common Roland desktop CNCs.

## [1.0.5] - 2026-02-03

### Added
- **Accessibility Documentation:** Included a [new script](.github/scripts/sync-accessibility.js) that generates doc/accessibility.html from doc/ACCESSIBILITY.md
- **Narrow Screen Warnings:** Added @media triggered nag messages to the Welcome, Quickstart modals and Workspace about narrow screens breaking the UI.

### Fixed
- **Enforced Climb Cutting:** Mirroring addition broke cutting direction enforcement, now there's a single enforcement point before toolpath translation.
- **Improved Documentation:** Changed hierarchy to include a doc/ folder with other content articles inside of it, reworked CSS for consistency across all pages.
- **Improved Theme Loading:** Added a [new script](.github/scripts/sync-theme.js) to sync dark theme to theme.css and made both theme .jsons lazy load only when necessary.
- **Improved Responsive CSS:** Reworked tool and documentation responsive CSS for very small screens to handle mobile browser safety margins better.

### Removed
- **Nav-tree Object Tooltip:** It was inconsistent and mostly useless. May try to add object statistics another way in the future.

### Changed
- **Small README Re-write**
- **Minor SEO Updates**


## [1.0.4] - 2026-01-27

### Added
- **Reworked Tool Loading Logic:** Complete re-writting of js module loading and initialization logic (cut load times by 50-90%).
- **New Node Build.js Optimizer:** Further expands css, json and js loading to optimize the deployed files that reach web users.
- **Fixed Modal Flexibility:** All UI elements should now be fully usable on smaller screens, even **landscape** smarphones.
- **Couple More SEO Changes**


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