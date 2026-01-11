# Examples & Calibration Files

This directory contains reference files to help you set up your machine, calibrate your axes, and learn the EasyTrace5000 workflow.

## Calibration Tools
Use these files to verify your CNC machine's accuracy and resolution before attempting a full board.

| File | Purpose |
| :--- | :--- |
| **`100mm_Calibration_Square.svg`** | **Axis Tuning.** Just a 100x100mm square. Cut this first to measure your real-world output and calibrate your $X/Y steps per mm$ settings. Remember to take run-out into account and check the Z axis too. |
| **`LineTest.svg`** | **DRC / Precision Test.** A pattern of expanding gaps and traces. Use this to find the limit of your V-bit's tip width and determine the minimum clearance and trace width your machine can handle. |

## Project Examples
Full board projects including Gerber and Excellon files to demonstrate different manufacturing techniques.

### 1. SMD Stress Test (Geometry Demo)
**Location:** `/exampleSMD1`  
**Focus:** Complex Boolean Operations, Text-as-Traces, SMD Pads.  
This board was originally selected to test the Clipper2 geometry engine's ability to handle complex boolean merges and hole winding in offsetting.
> *Note: Consider a placeholder, to be replaced by something useful in the near future.*

### 2. Through-Hole & Slots Demo
**Location:** `/exampleThroughHole1`
**Focus:** Drill sorting, Under and Oversized Slots, THT Pads.  
A functional design courtesy of Marcela. This example demonstrates how EasyTrace5000 handles drill files that contain both circular holes and milled slots.

---
## License Notice
While the software is **AGPL-3.0**:
* **The Step/mm Square SVG** is just a square, consider it public domain.
* **The Line-Test SVG** is licensed under **CC BY-NC 4.0** (Attribution-NonCommercial).
* **The SMD Example1** is licensed under **CC BY-NC 4.0** (Attribution-NonCommercial).
* **The Through-Hole Example1** is released by Marcela Gonzales Arias as public domain.

Please check the `README.md` inside each subfolder for specific details.