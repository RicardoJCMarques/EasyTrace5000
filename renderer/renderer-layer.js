/**
 * @file        renderer/renderer-layer.js
 * @description Manages canvas layers
 * @author      Eltryus - Ricardo Marques
 * @see         {@link https://github.com/RicardoJCMarques/EasyTrace5000}
 * @license     AGPL-3.0-or-later
 */

/*
 * EasyTrace5000 - Advanced PCB Isolation CAM Workspace
 * Copyright (C) 2025 Eltryus
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

(function() {
    'use strict';

    const config = window.PCBCAMConfig;
    const primitivesConfig = config.renderer?.primitives; // Review - useless config?

    class LayerRenderer {
        constructor(canvasId, core) {
            this.canvas = document.getElementById(canvasId);
            if (!this.canvas) {
                throw new Error(`Canvas element '${canvasId}' not found`);
            }

            this.core = new RendererCore(this.canvas);
            this.pcbCore = core;

            this.primitiveRenderer = new PrimitiveRenderer(this.core);
            this.overlayRenderer = new OverlayRenderer(this.core);
            this.interactionHandler = new InteractionHandler(this.core, this);

            this.debugPrimitives = [];
            this.debugPrimitivesScreen = []; // Store screen-space data
            this._renderQueued = false;
            this._renderHandle = null;

            this.core.resizeCanvas();
            this.interactionHandler.init();
        }

        // Property accessors

        get layers() { return this.core.layers; }
        get options() { return this.core.options; }
        get viewScale() { return this.core.viewScale; }
        get viewOffset() { return this.core.viewOffset; }
        get ctx() { return this.core.ctx; }
        get bounds() { return this.core.bounds; }
        get renderStats() { return this.core.renderStats; }

        setOptions(options) {
            this.core.setOptions(options);
            this.render();
        }

        setCoordinateSystem(coordinateSystem) {
            this.core.setCoordinateSystem(coordinateSystem);
        }

        addLayer(name, primitives, options = {}) {
            this.core.addLayer(name, primitives, options);
        }

        removeLayer(name) {
            this.core.removeLayer(name);
        }

        clearLayers() {
            this.core.clearLayers();
        }

        // Rendering

        render() {
            if (this._renderQueued) return;

            this._renderQueued = true;
            this._renderHandle = requestAnimationFrame(() => {
                this._renderQueued = false;
                this._actualRender();
            });
        }

       _actualRender() {
            const startTime = this.core.beginRender();
            this.core.clearCanvas();
            this.debugPrimitives = [];
            this.core.setupTransform(); // Sets pan/zoom
            this.ctx.save();

            // Apply object rotation
            if (this.core.currentRotation !== 0 && this.core.rotationCenter) {
                this.ctx.translate(this.core.rotationCenter.x, this.core.rotationCenter.y);
                this.ctx.rotate((this.core.currentRotation * Math.PI) / 180);
                this.ctx.translate(-this.core.rotationCenter.x, -this.core.rotationCenter.y);
            }

            // 1. Render Geometry (inside rotation)
            if (this.options.showWireframe) {
                this.layers.forEach(layer => {
                    if (layer.visible) {
                        this.renderWireframeLayer(layer);
                        // Collect debug primitives even in wireframe mode
                        if (this.options.debugPoints || this.options.debugArcs) {
                            layer.primitives.forEach(p => {
                                if (this.shouldCollectDebugPoints(p)) {
                                    this.debugPrimitives.push(p);
                                }
                            });
                        }
                    }
                });
            } else {
                this.renderVisibleLayers();
            }

            // 2. Restore from rotation
            this.ctx.restore();

            // 3. Render world-space overlays (outside rotation)
            if (this.options.showGrid) { this.overlayRenderer.renderGrid(); }
            if (this.options.showBounds) { this.overlayRenderer.renderBounds(); }
            if (this.options.showOrigin) { this.overlayRenderer.renderOrigin(); }

            // 4. Reset all transforms (to screen space)
            this.core.resetTransform();

            // 5. Render screen-space overlays
            if (this.options.showRulers) { this.overlayRenderer.renderRulers(); }
            this.overlayRenderer.renderScaleIndicator();
            if (this.options.showStats) { this.overlayRenderer.renderStats(); }

            // Pre-transform debug primitives to screen space
            if ((this.options.debugPoints || this.options.debugArcs) &&
                this.debugPrimitives.length > 0) {

                this.debugPrimitivesScreen = this.debugPrimitives.map(prim => {
                    const screenData = {
                        type: prim.type,
                        properties: prim.properties,
                        center: prim.center,
                        radius: prim.radius,
                        startAngle: prim.startAngle,
                        endAngle: prim.endAngle,
                        clockwise: prim.clockwise
                    };

                    // Transform points (for curve debug)
                    if (prim.points) {
                        screenData.screenPoints = prim.points.map(p => {
                            const s = this.core.worldToScreen(p.x, p.y);
                            return { ...s, ...p }; // Combine screen coords + original metadata
                        });
                    }

                    // Transform contours (for path/arc debug)
                    if (prim.contours) {
                        screenData.contours = prim.contours.map(c => ({
                            ...c, // Keep original contour data
                            // Transform points within the contour
                            screenPoints: c.points.map(p => this.core.worldToScreen(p.x, p.y)),
                            // Transform arc segments within the contour
                            arcSegments: c.arcSegments ? c.arcSegments.map(seg => ({
                                ...seg,
                                centerScreen: this.core.worldToScreen(seg.center.x, seg.center.y),
                                radiusScreen: seg.radius * this.core.viewScale
                            })) : []
                        }));
                    }
                    return screenData;
                });
                this.renderDebugOverlay();
            }
            this.core.endRender(startTime);
        }

        // Layer Rendering

        renderVisibleLayers() {
            const sourceLayers = [], fusedLayers = [], offsetLayers = [],
                previewLayers = [], toolpathLayers = [];

            // Categorize Layers
            this.layers.forEach((layer, name) => {
                if (!layer.visible) return;
                switch (layer.type) {
                    case 'offset': offsetLayers.push({ name, layer }); break;
                    case 'preview': previewLayers.push({ name, layer }); break;
                    case 'toolpath': toolpathLayers.push({ name, layer }); break;
                    case 'fused': fusedLayers.push({ name, layer }); break;
                    default: sourceLayers.push({ name, layer }); break;
                }
            });

            const cutoutLayers = [], drillLayers = [], otherSourceLayers = [];
            sourceLayers.forEach(({ name, layer }) => {
                if (layer.type === 'cutout') cutoutLayers.push({ name, layer });
                else if (layer.type === 'drill') drillLayers.push({ name, layer });
                else otherSourceLayers.push({ name, layer });
            });

            // Sort function to force Drills to top within their category
            // Returns: -1 (A first/bottom), 1 (B first/bottom), 0 (Same)
            const sortByOpType = (a, b) => {
                const isDrillA = a.layer.operationType === 'drill' || a.layer.type === 'drill';
                const isDrillB = b.layer.operationType === 'drill' || b.layer.type === 'drill';
                if (isDrillA && !isDrillB) return 1;  // Drill (A) goes after Non-Drill (B)
                if (!isDrillA && isDrillB) return -1; // Non-Drill (A) goes before Drill (B)
                return 0;
            };

            // Apply Sort to Processed Layers
            offsetLayers.sort(sortByOpType);
            previewLayers.sort(sortByOpType);

            // Render Stack

            // Source Geometry (Bottom)
            // Cutouts first (lowest), then Traces, then Drills (highest source)
            cutoutLayers.forEach(({ layer }) => this.renderLayer(layer));
            otherSourceLayers.forEach(({ layer }) => this.renderLayer(layer));
            drillLayers.forEach(({ layer }) => this.renderLayer(layer));

            // Fused Geometry
            fusedLayers.forEach(({ layer }) => this.renderLayer(layer));
            
            // Processed Geometry (Top)
            // The sort above ensures Drill Offsets > Isolation Offsets
            offsetLayers.forEach(({ layer }) => this.renderOffsetLayer(layer));
            previewLayers.forEach(({ layer }) => this.renderPreviewLayer(layer));
            
            // Toolpaths (Very Top)
            toolpathLayers.forEach(({ layer }) => this.renderLayer(layer));
        }

        renderLayer(layer) {
            let layerColor = this.core.getLayerColorSettings(layer);    
            if (this.options.blackAndWhite) {
                // Cutouts render as black (board outline), everything else white
                if (layer.type === 'cutout') {
                    layerColor = this.core.colors.bw.black;
                } else {
                    layerColor = this.core.colors.bw.white;
                }
            }
            const viewBounds = this.core.getViewBounds();
            this.renderLayerPrimitives(layer, viewBounds, layerColor, layerColor);
        }

        renderLayerPrimitives(layer, viewBounds, fillColor, strokeColor = null) {
            const vb = viewBounds || this.core.getViewBounds();
            const isRotated = this.core.currentRotation !== 0;

            const displayBounds = isRotated ? this._getRotatedLayerBounds(layer) : layer.bounds;

            if (!displayBounds || !this.core.boundsIntersect(displayBounds, vb)) {
                this.core.renderStats.primitives += layer.primitives.length;
                this.core.renderStats.skippedPrimitives += layer.primitives.length;
                return;
            }

            this.ctx.fillStyle = fillColor;
            if (strokeColor) this.ctx.strokeStyle = strokeColor;

            let simpleFlashBatch = null;
            const strokeBatches = new Map();

            const flushFlashBatch = () => {
                if (simpleFlashBatch) {
                    this.ctx.fill(simpleFlashBatch, 'evenodd');
                    this.core.renderStats.drawCalls++;
                    simpleFlashBatch = null;
                }
            };

            const flushStrokeBatches = () => {
                if (strokeBatches.size > 0) {
                    this.ctx.strokeStyle = strokeColor || fillColor;
                    this.ctx.lineCap = 'round';
                    this.ctx.lineJoin = 'round';
                    strokeBatches.forEach((batch, width) => {
                        this.ctx.lineWidth = width;
                        this.ctx.stroke(batch);
                        this.core.renderStats.drawCalls++;
                    });
                    strokeBatches.clear();
                }
            };

            layer.primitives.forEach((primitive) => {
                this.core.renderStats.primitives++;

                const primBounds = primitive.getBounds();

                if (!this.core.boundsIntersect(primBounds, viewBounds)) {
                    this.core.renderStats.skippedPrimitives++;
                    return;
                }

                if (!this.core.shouldRenderPrimitive(primitive, layer.type)) {
                    this.core.renderStats.skippedPrimitives++;
                    return;
                }

                if (this.shouldCollectDebugPoints(primitive)) {
                    this.debugPrimitives.push(primitive);
                }

                this.core.renderStats.renderedPrimitives++;

                const role = primitive.properties?.role;
                const isCenterline = primitive.properties?.isCenterlinePath;
                const isStroke = primitive.properties?.stroke && !primitive.properties?.fill;

                const cannotBatch = (
                    role === 'drill_hole' ||
                    role === 'drill_slot' ||
                    role === 'peck_mark' ||
                    role === 'drill_milling_path' ||
                    isCenterline
                );

                if (cannotBatch) {
                    flushFlashBatch();
                    flushStrokeBatches();
                    this.ctx.save();
                    this.primitiveRenderer.renderPrimitive(
                        primitive, fillColor, strokeColor, layer.isPreprocessed, 
                        { layer: layer }
                    );
                    this.ctx.restore();
                    this.core.renderStats.drawCalls++;
                    return;
                }

                // Batch strokes by width (traces)
                if (isStroke && primitive.properties?.strokeWidth) {
                    const width = primitive.properties.strokeWidth;
                    if (!strokeBatches.has(width)) {
                        strokeBatches.set(width, new Path2D());
                    }
                    this.primitiveRenderer.addPrimitiveToPath2D(primitive, strokeBatches.get(width));
                    return;
                }

                // Batch simple filled shapes
                if (primitive.type === 'circle' || primitive.type === 'rectangle' || primitive.type === 'obround') {
                    if (!simpleFlashBatch) {
                        simpleFlashBatch = new Path2D();
                    }
                    this.primitiveRenderer.addPrimitiveToPath2D(primitive, simpleFlashBatch);
                } else {
                    flushFlashBatch();
                    flushStrokeBatches();
                    this.ctx.save();
                    this.primitiveRenderer.renderPrimitive(
                        primitive, fillColor, strokeColor, layer.isPreprocessed,
                        { layer: layer }
                    );
                    this.ctx.restore();
                    this.core.renderStats.drawCalls++;
                }
            });

            flushFlashBatch();
            flushStrokeBatches();
        }
        
        // Specialized Layer Batch Renderers
        renderOffsetLayer(layer) {
            const viewBounds = this.core.getViewBounds();
            const isRotated = this.core.currentRotation !== 0;

            const displayBounds = isRotated ? this._getRotatedLayerBounds(layer) : layer.bounds;
            if (!displayBounds || !this.core.boundsIntersect(displayBounds, viewBounds)) {
                this.core.renderStats.primitives += layer.primitives.length;
                this.core.renderStats.skippedPrimitives += layer.primitives.length;
                return;
            }

            const offsetColor = this.core.getLayerColorSettings(layer);

            // Buckets for Internal Sorting (Z-Index)
            const standardGeometry = [];
            const drillMillingPaths = []; // Undersized slots, Centerlines
            const peckMarks = [];

            // Distribute
            layer.primitives.forEach((primitive) => {
                this.core.renderStats.primitives++;

                const primBounds = primitive.getBounds();
                if (!isRotated && !this.core.boundsIntersect(primBounds, viewBounds)) {
                    this.core.renderStats.skippedPrimitives++;
                    return;
                }

                if (!this.core.shouldRenderPrimitive(primitive, layer.type)) {
                    this.core.renderStats.skippedPrimitives++;
                    return;
                }
                this.core.renderStats.renderedPrimitives++;

                // Categorize
                if (primitive.properties?.role === 'peck_mark' || 
                    primitive.properties?.isToolPeckMark) {
                    peckMarks.push(primitive);
                } else if (primitive.properties?.role === 'drill_milling_path' || 
                        primitive.properties?.isCenterlinePath) {
                    drillMillingPaths.push(primitive);
                } else {
                    standardGeometry.push(primitive);
                }
            });

            // Render Stack (Bottom to Top)
            // Standard Offsets (Isolation traces, etc.)
            standardGeometry.forEach(prim => {
                this.ctx.save();
                this.primitiveRenderer.renderOffsetPrimitive(prim, offsetColor, { layer: layer });
                this.ctx.restore();
                this.core.renderStats.drawCalls++;
            });

            // Drill Milling Paths (Yellow/Red slots)
            drillMillingPaths.forEach(prim => {
                this.ctx.save();
                this.primitiveRenderer.renderOffsetPrimitive(prim, offsetColor, { layer: layer });
                this.ctx.restore();
                this.core.renderStats.drawCalls++;
            });

            // Peck Marks (Crosshairs)
            peckMarks.forEach(prim => {
                this.ctx.save();
                this.primitiveRenderer.renderPeckMark(prim, { layer: layer });
                this.ctx.restore();
                this.core.renderStats.drawCalls++;
            });
        }

        renderPreviewLayer(layer) {
            const viewBounds = this.core.getViewBounds();
            const isRotated = this.core.currentRotation !== 0;

            const displayBounds = isRotated ? this._getRotatedLayerBounds(layer) : layer.bounds;
            if (!displayBounds || !this.core.boundsIntersect(displayBounds, viewBounds)) {
                this.core.renderStats.primitives += layer.primitives.length;
                this.core.renderStats.skippedPrimitives += layer.primitives.length;
                return;
            }

            const previewColor = this.core.getLayerColorSettings(layer);

            // Buckets for Internal Sorting
            // Note: Standard geometry uses a Map for batching, others use arrays
            const standardBatch = new Map();
            const drillMillingPaths = []; 
            const peckMarks = [];

            // Distribute
            layer.primitives.forEach((primitive) => {
                this.core.renderStats.primitives++;

                const primBounds = primitive.getBounds();
                if (!isRotated && !this.core.boundsIntersect(primBounds, viewBounds)) {
                    this.core.renderStats.skippedPrimitives++;
                    return;
                }
                if (!this.core.shouldRenderPrimitive(primitive, layer.type)) {
                    this.core.renderStats.skippedPrimitives++;
                    return;
                }
                this.core.renderStats.renderedPrimitives++;

                // Categorize
                if (primitive.properties?.role === 'peck_mark') {
                    peckMarks.push(primitive);
                    return;
                }

                if (primitive.properties?.isCenterlinePath || 
                    primitive.properties?.toolRelation ||
                    primitive.properties?.role === 'drill_milling_path') {
                    
                    drillMillingPaths.push(primitive);
                    return;
                }

                // Standard Batching
                const toolDiameter = layer.metadata?.toolDiameter || 
                                    primitive.properties?.toolDiameter ||
                                    this.getToolDiameterForPrimitive(primitive); 

                if (!standardBatch.has(toolDiameter)) {
                    standardBatch.set(toolDiameter, new Path2D());
                }
                this.primitiveRenderer.addPrimitiveToPath2D(primitive, standardBatch.get(toolDiameter));
            });

            // Render Stack (Bottom to Top)
            // tandard Geometry (Batched Strokes)
            this.ctx.strokeStyle = previewColor;
            this.ctx.lineCap = 'round';
            this.ctx.lineJoin = 'round';

            standardBatch.forEach((batch, toolDiameter) => {
                this.ctx.lineWidth = toolDiameter;
                this.ctx.stroke(batch);
                this.core.renderStats.drawCalls++;
            });

            // Drill Milling Paths (Solid Fills)
            drillMillingPaths.forEach(primitive => {
                this.ctx.save();
                if (primitive.properties?.isCenterlinePath) {
                    this.primitiveRenderer.renderCenterlineSlot(primitive, { 
                        layer, toolDiameter: primitive.properties.toolDiameter 
                    });
                } else {
                    // Standard Milling Preview (Blue Stroke) includes Yellow marks because it's always undersized
                    const toolDia = primitive.properties.toolDiameter || layer.metadata?.toolDiameter;
                    this.primitiveRenderer.renderToolPreview(primitive, previewColor, {
                        layer, toolDiameter: toolDia
                    });
                }
                this.ctx.restore();
                this.core.renderStats.drawCalls++;
            });

            // Peck Marks
            peckMarks.forEach(primitive => {
                this.ctx.save();
                this.primitiveRenderer.renderPeckMark(primitive, { layer: layer });
                this.ctx.restore();
                this.core.renderStats.drawCalls++;
            });
        }

        renderWireframeLayer(layer) {
            const viewBounds = this.core.getViewBounds();
            const wireframeBatch = new Path2D();

            layer.primitives.forEach((primitive) => {
                this.core.renderStats.primitives++;
                const primBounds = primitive.getBounds();
                if (!this.core.boundsIntersect(primBounds, viewBounds)) {
                    this.core.renderStats.skippedPrimitives++;
                    return;
                }
                this.core.renderStats.renderedPrimitives++;
                // Use the existing logic to add any primitive type to the batch
                this.primitiveRenderer.addPrimitiveToPath2D(primitive, wireframeBatch);
            });

            // Perform a single stroke operation for the entire layer
            this.ctx.strokeStyle = this.core.colors.debug.wireframe;
            this.ctx.lineWidth = this.core.getWireframeStrokeWidth();
            this.ctx.fillStyle = 'transparent'; // Ensure no fill
            this.ctx.setLineDash([]);
            this.ctx.stroke(wireframeBatch);
            this.core.renderStats.drawCalls++;
        }

        getToolDiameterForPrimitive(primitive) {
            const opId = primitive.properties?.operationId;
            if (!opId || !this.pcbCore || !this.pcbCore.operations) {
                return null;
            }
            const operation = this.pcbCore.operations.find(op => op.id === opId);
            const diameterStr = operation?.settings?.toolDiameter;
            if (diameterStr !== undefined) {
                const diameter = parseFloat(diameterStr);
                return isNaN(diameter) ? null : diameter;
            }
            return null;
        }

        _getRotatedLayerBounds(layer) {
            const bounds = layer.bounds;
            if (!bounds || this.core.currentRotation === 0) {
                return bounds;
            }
            const corners = [
                { x: bounds.minX, y: bounds.minY },
                { x: bounds.maxX, y: bounds.minY },
                { x: bounds.maxX, y: bounds.maxY },
                { x: bounds.minX, y: bounds.maxY }
            ];
            const rotationCenter = this.core.rotationCenter || { x: 0, y: 0 };
            const angle = (this.core.currentRotation * Math.PI) / 180;
            const cos = Math.cos(angle);
            const sin = Math.sin(angle);

            const rotatedCorners = corners.map(corner => {
                const dx = corner.x - rotationCenter.x;
                const dy = corner.y - rotationCenter.y;
                return {
                    x: rotationCenter.x + (dx * cos - dy * sin),
                    y: rotationCenter.y + (dx * sin + dy * cos)
                };
            });

            let minX = Infinity, minY = Infinity;
            let maxX = -Infinity, maxY = -Infinity;
            rotatedCorners.forEach(corner => {
                minX = Math.min(minX, corner.x);
                minY = Math.min(minY, corner.y);
                maxX = Math.max(maxX, corner.x);
                maxY = Math.max(maxY, corner.y);
            });
            return { minX, minY, maxX, maxY };
        }
        
        shouldCollectDebugPoints(primitive) {
            const anyDebugEnabled = this.options.debugPoints || this.options.debugArcs;
            if (!anyDebugEnabled) return false;
            
            // Reconstructed circles
            if (primitive.type === 'circle') {
                return true;
            }

            // Reconstructed paths
            if (primitive.type === 'path') {
                if (primitive.contours && primitive.contours.length > 0) {
                    return true;
                }
            }

            // Reconstructed arcs
            if (primitive.type === 'arc') {
                return true;
            }

            return false;
        }
        
        // Debug Overlay
        
        renderDebugOverlay() {
            if (!this.debugPrimitivesScreen || this.debugPrimitivesScreen.length === 0) return;

            this.ctx.save();
            this.ctx.setTransform(1, 0, 0, 1, 0, 0);

            const pointColor = this.core.colors.debug.points;
            const arcColor = this.core.colors.debug.arcs;
            const pointSize = 3;
            const arcStrokeWidth = 2;

            // Batch all points
            if (this.options.debugPoints) {
                this.ctx.fillStyle = pointColor;
                this.ctx.beginPath();

                for (const prim of this.debugPrimitivesScreen) {
                    // Circle primitive centers
                    if (prim.type === 'circle' && prim.center) {
                        const screenCenter = this.core.worldToScreen(prim.center.x, prim.center.y);
                        this.ctx.moveTo(screenCenter.x + pointSize, screenCenter.y);
                        this.ctx.arc(screenCenter.x, screenCenter.y, pointSize, 0, Math.PI * 2);
                    }

                    // Contour points and arc centers
                    if (prim.contours) {
                        for (const contour of prim.contours) {
                            if (contour.screenPoints) {
                                for (const p of contour.screenPoints) {
                                    this.ctx.moveTo(p.x + pointSize, p.y);
                                    this.ctx.arc(p.x, p.y, pointSize, 0, Math.PI * 2);
                                }
                            }
                            if (contour.arcSegments) {
                                for (const arc of contour.arcSegments) {
                                    if (arc.centerScreen) {
                                        this.ctx.moveTo(arc.centerScreen.x + pointSize, arc.centerScreen.y);
                                        this.ctx.arc(arc.centerScreen.x, arc.centerScreen.y, pointSize, 0, Math.PI * 2);
                                    }
                                }
                            }
                        }
                    }
                }
                this.ctx.fill();
            }

            // Batch all reconstructed arcs
            if (this.options.debugArcs) {
                this.ctx.strokeStyle = arcColor;
                this.ctx.lineWidth = arcStrokeWidth;
                this.ctx.beginPath();

                for (const prim of this.debugPrimitivesScreen) {
                    if (!prim.contours) continue;
                    for (const contour of prim.contours) {
                        if (!contour.arcSegments || contour.arcSegments.length === 0) continue;
                        for (const arc of contour.arcSegments) {
                            if (!arc.centerScreen) continue;
                            this.ctx.moveTo(
                                arc.centerScreen.x + arc.radiusScreen * Math.cos(arc.startAngle),
                                arc.centerScreen.y - arc.radiusScreen * Math.sin(arc.startAngle)
                            );
                            this.ctx.arc(
                                arc.centerScreen.x,
                                arc.centerScreen.y,
                                arc.radiusScreen,
                                -arc.startAngle,  // Negate for screen Y-down
                                -arc.endAngle,
                                arc.clockwise
                            );
                        }
                    }
                }
                this.ctx.stroke();
            }

            // Batch reconstructed full circles
            if (this.options.debugArcs) {
                this.ctx.strokeStyle = arcColor;
                this.ctx.lineWidth = arcStrokeWidth;
                this.ctx.beginPath();

                for (const prim of this.debugPrimitivesScreen) {
                    if (prim.type === 'circle' && prim.properties?.reconstructed) {
                        const screenCenter = this.core.worldToScreen(prim.center.x, prim.center.y);
                        const screenRadius = prim.radius * this.core.viewScale;
                        this.ctx.moveTo(screenCenter.x + screenRadius, screenCenter.y);
                        this.ctx.arc(screenCenter.x, screenCenter.y, screenRadius, 0, Math.PI * 2);
                    }
                }
                this.ctx.stroke();
            }

            this.ctx.restore();
        }

        destroy() {
            if (this.interactionHandler) {
                this.interactionHandler.destroy();
            }
            if (this._renderHandle) {
                cancelAnimationFrame(this._renderHandle);
            }
        }
    }
    
    window.LayerRenderer = LayerRenderer;
})();