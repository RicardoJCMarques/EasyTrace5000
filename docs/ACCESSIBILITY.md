# Accessibility

EasyTrace5000 is designed to be usable with keyboard-only navigation and compatible with assistive technologies. This document details keyboard controls, focus management, and WCAG 2.1 compliance efforts.

## Table of Contents

- [Keyboard Navigation Overview](#keyboard-navigation-overview)
- [Zone Navigation](#zone-navigation)
- [Operations Tree](#operations-tree)
- [Canvas Controls](#canvas-controls)
- [Property Panel](#property-panel)
- [Modals](#modals)
- [Screen Reader Support](#screen-reader-support)
- [WCAG 2.1 Compliance](#wcag-21-compliance)
- [Known Limitations](#known-limitations)
- [Reporting Issues](#reporting-issues)

---

## Keyboard Navigation Overview

The interface is divided into navigable zones.

### Global Navigation

| Key | Action |
|-----|--------|
| `F6` | Cycle forward through zones (Toolbar → Sidebar → Canvas) |
| `Shift` + `F6` | Cycle backwards through zones |
| `Tab` | Navigate focusable elements within a zone |

### Zones

| Zone | Description |
|------|-------------|
| Toolbar | Top menu bar with actions and view controls |
| Operations Tree | Left sidebar with file/operation hierarchy |
| Canvas | Central preview area |
| Properties Panel | Right sidebar with parameters and settings |

A **skip link** appears on Tab from page load, allowing keyboard users to jump directly to the canvas.

---

## Zone Navigation

### Toolbar

| Key | Action |
|-----|--------|
| `←` / `→` | Navigate between toolbar buttons |
| `Enter` / `Space` | Activate focused button |
| `Escape` | Close open dropdown menus |

### Sidebar Sections (Collapsible)

| Key | Action |
|-----|--------|
| `Enter` / `Space` | Toggle section expand/collapse |
| `↓` / `↑` | Navigate between sections or fields within |

---

## Operations Tree

The operations tree uses a hierarchical structure with categories, files, and geometry nodes.

### Navigation

| Key | Action |
|-----|--------|
| `↓` | Move to next visible item |
| `↑` | Move to previous visible item |
| `→` | Expand category/file, or move into children |
| `←` | Collapse category/file, or move to parent |
| `Home` | Jump to first item |
| `End` | Jump to last item |

### Actions

| Key | Action |
|-----|--------|
| `Enter` / `Space` | Select item and open properties; toggle category expand |
| `Delete` | Remove selected file or geometry |
| `V` | Toggle visibility of selected layer |

### ARIA Roles

- Tree container: `role="tree"`
- Category headers: `role="treeitem"` with `aria-expanded`
- File/geometry nodes: `role="treeitem"` with `aria-selected`

---

## Canvas Controls

When focus is on the canvas or workspace (not in input fields):

### View Controls

| Key | Action |
|-----|--------|
| `Home` | Fit all geometry to view |
| `F` | Fit to view (alternative) |
| `=` | Fit to view (alternative) |
| `+` / `NumpadAdd` | Zoom in |
| `-` / `NumpadSubtract` | Zoom out |

### Panning

| Key | Action |
|-----|--------|
| `←` | Pan left |
| `→` | Pan right |
| `↑` | Pan up |
| `↓` | Pan down |
| `Shift` + Arrow | Fast pan |

### Display Toggles

| Key | Action |
|-----|--------|
| `W` | Toggle wireframe mode |
| `G` | Toggle grid visibility |

### Origin Controls

| Key | Action |
|-----|--------|
| `B` | Set origin to bottom-left |
| `O` | Save current origin |
| `C` | Set origin to center |

### Help

| Key | Action |
|-----|--------|
| `?` / `F1` | Show keyboard shortcuts summary |

---

## Property Panel

When a file or geometry is selected, the property panel displays editable parameters.

### Field Navigation

| Key | Action |
|-----|--------|
| `↓` | Move to next field/row |
| `↑` | Move to previous field/row |
| `Enter` / `Space` | Enter edit mode on focused row |
| `Enter` (in input) | Commit value and move to next field |
| `Escape` | Exit edit mode, return focus to row |
| `Tab` | Standard tab navigation between focusable elements |

### Tooltip Icons

Help icons (`?`) next to labels can be focused with Tab and activated to show tooltips.

---

## Modals

Modals (Welcome, Quickstart, G-code Export, Support) implement focus trapping and keyboard controls.

### General Modal Controls

| Key | Action |
|-----|--------|
| `Escape` | Close modal (context-aware: may return to previous modal) |
| `Tab` | Cycle through focusable elements (trapped within modal) |
| `Shift+Tab` | Cycle backwards |
| `↓` / `↑` | Navigate form fields |

### G-code Export Modal - Sortable List

The operation order list supports keyboard reordering:

| Key | Action |
|-----|--------|
| `Space` | Grab/drop item for reordering |
| `↓` / `↑` (while grabbed) | Move item up/down in list |
| `Escape` | Cancel reorder operation |

---

## Screen Reader Support

### Live Regions

- **Status bar**: Uses `aria-live="polite"` for general updates, `aria-live="assertive"` for errors
- Status messages announce file loading, operation completion, and errors

### Semantic Structure

- Main landmarks: `<header>` (toolbar), `<main>` (canvas), `<aside>` (sidebars), `<footer>` (status bar)
- Headings hierarchy maintained within sections
- Form labels associated with inputs via `for`/`id`

### Button Labels

All icon-only buttons include `aria-label` attributes describing their function:
- "Fit to View", "Zoom In", "Zoom Out"
- "Toggle Visibility", "Delete", etc.

### SVG Icons

Decorative icons include `aria-hidden="true"` to prevent screen reader noise.

---

## WCAG 2.1 Compliance

EasyTrace5000 targets **WCAG 2.1 Level AA** compliance. While the application is fully functional for keyboard users, some visual aspects (such as complex canvas geometry) have inherent limitations.

### Implemented Guidelines

| Guideline | Description | Status | Implementation Notes |
|-----------|-------------|--------|----------------------|
| **1.1.1** | Non-text Content | ✓ | Icon-only buttons include `aria-label` attributes; decorative icons use `aria-hidden="true"`. |
| **1.3.1** | Info and Relationships | ✓ | Semantic HTML5 landmarks (`<main>`, `<aside>`, `<nav>`) and proper ARIA tree roles for the Operations panel. |
| **1.3.2** | Meaningful Sequence | ✓ | DOM order matches the visual layout; focus order flows logically through sidebars and canvas. |
| **1.4.1** | Use of Color | ✓ | Status messages (Success/Error) use both text labels and color indicators. |
| **1.4.3** | Contrast (Minimum) | ✓ | Default text-to-background contrast ratios meet the 4.5:1 standard. |
| **1.4.13**| Content on Hover/Focus| ✓ | Custom `TooltipManager` ensures tooltips are persistent on focus, hoverable, and do not obscure active content. |
| **2.1.1** | Keyboard | ✓ | All interactive elements (buttons, inputs, tree nodes, canvas) are keyboard accessible. |
| **2.1.2** | No Keyboard Trap | ✓ | Modal dialogs trap focus intentionally while open but release it correctly upon closing. |
| **2.1.4** | Character Key Shortcuts| ✓ | Single-key shortcuts (e.g., `V` for visibility, `Del` for delete) are scoped to the active region (Tree/Canvas) and disabled during text entry. |
| **2.4.1** | Bypass Blocks | ✓ | A "Skip to Canvas" link appears on the first Tab press. |
| **2.4.3** | Focus Order | ✓ | Modals and panels manage focus logically; closing a modal returns focus to the triggering element. |
| **2.4.6** | Headings and Labels | ✓ | Descriptive headings identify all major workspace sections; inputs have associated `<label>` elements. |
| **2.4.7** | Focus Visible | ✓ | High-contrast CSS focus rings (`:focus-visible`) appear on all interactive elements. |
| **2.5.3** | Label in Name | ✓ | Accessible names for icon buttons match their visual tooltips (e.g., "Fit to View"). |
| **3.2.1** | On Focus | ✓ | Focusing on input fields or tree items never triggers a context change (submit/navigation). |
| **3.2.2** | On Input | ✓ | Parameter changes update the preview or require explicit confirmation; no unexpected page reloads. |
| **4.1.2** | Name, Role, Value | ✓ | Custom controls (Tree View, Toggles) use correct ARIA roles (`tree`, `treeitem`, `button`). |
| **4.1.3** | Status Messages | ✓ | Dynamic updates (file loading, success messages) are announced via `aria-live` regions. |

### Partial or Planned Support

| Guideline | Description | Status | Notes |
|-----------|-------------|--------|-------|
| **1.4.11**| Non-text Contrast | Partial | Some UI borders and disabled states in the default theme may fall below 3:1. High Contrast themes are supported by the engine and are currently in development. |
| **1.2.x** | Time-based Media | N/A | The application does not contain audio or video content. |

---

## Known Limitations

1. **Canvas interaction**: The 2D canvas preview is visual-only. Geometry data is available via the operations tree, but spatial relationships require visual inspection.

2. **Complex geometry feedback**: When generating offsets or previews, detailed geometric results are shown visually but not fully announced to screen readers beyond success/failure status.

3. **Drag-and-drop file upload**: Requires mouse. Alternative: Click drop zones or use the file input buttons in the operations tree.

4. **Touch devices**: Touch zoom/pan works but keyboard navigation is primary accessibility path.

5. **Color-coded warnings**: Drill operation warnings use color coding (green/yellow/red). Status messages provide text descriptions.

---

## Reporting Issues

If you encounter accessibility barriers, please report them via **GitHub Issues**.

We have a dedicated template for these reports to ensure we get the necessary technical details.

1. Go to the [New Issue page](https://github.com/RicardoJCMarques/Eltryus_CAM/issues/new/choose)
2. Select the **Accessibility Report** template
3. Fill in the required details (Browser, OS, Assistive Technology)

---

## Resources

- [WCAG 2.1 Guidelines](https://www.w3.org/WAI/WCAG21/quickref/)
- [WAI-ARIA Authoring Practices](https://www.w3.org/WAI/ARIA/apg/)
- [WebAIM Keyboard Testing](https://webaim.org/techniques/keyboard/)