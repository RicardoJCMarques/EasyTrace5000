// Layer Renderer - FIXED: Simplified cutout filtering and professional coordinate sync
// renderer/layer-renderer.js

class LayerRenderer {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        if (!this.canvas) {
            throw new Error(`Canvas element with id '${canvasId}' not found`);
        }
        
        this.ctx = this.canvas.getContext('2d');
        if (!this.ctx) {
            throw new Error('Could not get 2D context from canvas');
        }
        
        // View state
        this.viewOffset = { x: 0, y: 0 };
        this.viewScale = 1;
        this.bounds = null;
        
        // PROFESSIONAL: Coordinate system integration
        this.coordinateSystem = null;
        
        // Render options with geometry type controls
        this.options = {
            showFill: true,
            showPads: true,
            blackAndWhite: false,
            showGrid: true,
            showOrigin: true,
            showBounds: false,
            showRulers: true,
            // Geometry type controls
            showRegions: true,
            showTraces: true,
            showDrills: true,
            showCutouts: true,
            showOriginal: true,
            theme: 'dark',
            debug: false
        };
        
        // PROFESSIONAL: Track origin position for coordinate system display
        this.originPosition = { x: 0, y: 0 };
        
        // Enhanced color schemes with unique colors per operation type
        this.colors = {
            dark: {
                background: '#1a1a1a',
                isolation: '#ff8844',    // Orange for isolation routing
                clear: '#44ff88',        // Green for copper clearing  
                drill: '#4488ff',        // Blue for drilling
                cutout: '#ff00ff',       // Magenta for board cutout
                copper: '#ff8844',       // Fallback copper color
                nonConductor: '#666666',
                grid: '#333333',
                origin: '#ffffff',
                originOutline: '#000000',
                bounds: '#ff0000',
                ruler: '#888888',
                rulerText: '#cccccc'
            },
            light: {
                background: '#ffffff',
                isolation: '#cc6600',    // Dark orange for isolation
                clear: '#008844',        // Dark green for clearing
                drill: '#0066cc',        // Dark blue for drilling  
                cutout: '#cc00cc',       // Dark magenta for cutout
                copper: '#cc6600',       // Fallback copper color
                nonConductor: '#999999',
                grid: '#cccccc',
                origin: '#000000',
                originOutline: '#ffffff',
                bounds: '#ff0000',
                ruler: '#666666',
                rulerText: '#333333'
            }
        };
        
        // Layers storage
        this.layers = new Map();
        
        // Rendering validation and debugging
        this.validationResults = new Map();
        this.renderingIssues = [];
        
        // Stats
        this.renderStats = {
            primitives: 0,
            renderTime: 0,
            coordinateIssues: 0,
            transformedPrimitives: 0,
            untransformedPrimitives: 0
        };
        
        // Zoom constraints
        this.minZoom = 0.01;
        this.maxZoom = 1000;
        
        this.setupEventListeners();
        this.resizeCanvas();
        
        console.log('PROFESSIONAL: LayerRenderer initialized with simplified cutout filtering');
    }
    
    setOptions(options) {
        Object.assign(this.options, options);
        this.render();
    }
    
    addLayer(name, primitives, options = {}) {
        // Validate primitives before adding to layer
        const validationResult = this.validateLayerPrimitives(primitives);
        this.validationResults.set(name, validationResult);
        
        if (validationResult.criticalIssues > 0) {
            console.warn(`[LayerRenderer-PROFESSIONAL] Layer '${name}' has ${validationResult.criticalIssues} critical coordinate issues`);
        }
        
        // CUTOUT-DEBUG: Log detailed information for cutout layers
        if (options.type === 'cutout') {
            console.log(`[CUTOUT-DEBUG] Adding cutout layer '${name}' with ${primitives.length} primitives`);
            console.log(`[CUTOUT-DEBUG] Primitive types:`, primitives.map(p => `${p.type}(closed:${p.closed || false})`));
            
            // Log first few primitives in detail
            primitives.slice(0, 3).forEach((primitive, index) => {
                const bounds = primitive.getBounds();
                console.log(`[CUTOUT-DEBUG] Primitive ${index}: type=${primitive.type}, closed=${primitive.closed || false}, bounds=(${bounds.minX.toFixed(1)}, ${bounds.minY.toFixed(1)}) to (${bounds.maxX.toFixed(1)}, ${bounds.maxY.toFixed(1)}), properties=`, primitive.properties);
            });
        }
        
        this.layers.set(name, {
            name: name,
            primitives: primitives,
            visible: options.visible !== false,
            type: options.type || 'copper',
            bounds: options.bounds || this.calculateLayerBounds(primitives),
            color: options.color || null,
            validation: validationResult
        });
        
        this.calculateOverallBounds();
        this.render();
    }
    
    /**
     * Validate primitives in a layer for coordinate consistency
     */
    validateLayerPrimitives(primitives) {
        if (!primitives || primitives.length === 0) {
            return {
                valid: true,
                primitiveCount: 0,
                transformedCount: 0,
                untransformedCount: 0,
                unknownCount: 0,
                criticalIssues: 0,
                warnings: 0,
                coordinateRanges: null
            };
        }
        
        let transformedCount = 0;
        let untransformedCount = 0;
        let unknownCount = 0;
        let criticalIssues = 0;
        let warnings = 0;
        
        let minX = Infinity, minY = Infinity;
        let maxX = -Infinity, maxY = -Infinity;
        
        const issues = [];
        
        primitives.forEach((primitive, index) => {
            // Check transformation status
            const wasTransformed = primitive.wasTransformedDuringCreation?.() || false;
            if (wasTransformed === true) {
                transformedCount++;
            } else if (wasTransformed === false) {
                untransformedCount++;
            } else {
                unknownCount++;
            }
            
            // Validate bounds
            const bounds = primitive.getBounds();
            if (!isFinite(bounds.minX) || !isFinite(bounds.minY) || 
                !isFinite(bounds.maxX) || !isFinite(bounds.maxY)) {
                criticalIssues++;
                issues.push({
                    type: 'invalid_bounds',
                    index: index,
                    message: `Primitive ${index} has invalid bounds`,
                    primitive: primitive
                });
                return;
            }
            
            // Update coordinate ranges
            minX = Math.min(minX, bounds.minX);
            minY = Math.min(minY, bounds.minY);
            maxX = Math.max(maxX, bounds.maxX);
            maxY = Math.max(maxY, bounds.maxY);
            
            // Check for extremely large coordinates
            const maxCoord = 1000; // mm
            if (Math.abs(bounds.minX) > maxCoord || Math.abs(bounds.minY) > maxCoord ||
                Math.abs(bounds.maxX) > maxCoord || Math.abs(bounds.maxY) > maxCoord) {
                warnings++;
                issues.push({
                    type: 'large_coordinates',
                    index: index,
                    message: `Primitive ${index} has suspiciously large coordinates (may be untransformed)`,
                    bounds: bounds,
                    primitive: primitive
                });
            }
        });
        
        const result = {
            valid: criticalIssues === 0,
            primitiveCount: primitives.length,
            transformedCount,
            untransformedCount,
            unknownCount,
            criticalIssues,
            warnings,
            coordinateRanges: isFinite(minX) ? { minX, minY, maxX, maxY } : null,
            issues: issues
        };
        
        if (this.options.debug) {
            console.log(`[LayerRenderer-PROFESSIONAL] Layer validation result:`, result);
        }
        
        return result;
    }
    
    /**
     * Analyze coordinate consistency across all layers
     */
    validateCoordinateConsistency() {
        const analysis = {
            totalLayers: this.layers.size,
            totalPrimitives: 0,
            globalTransformationStatus: {
                transformed: 0,
                untransformed: 0,
                unknown: 0
            },
            coordinateRangesByType: {},
            alignmentIssues: [],
            criticalIssues: 0,
            warnings: 0
        };
        
        // Collect data from all layers
        this.layers.forEach((layer, layerName) => {
            const validation = layer.validation;
            if (!validation) return;
            
            analysis.totalPrimitives += validation.primitiveCount;
            analysis.globalTransformationStatus.transformed += validation.transformedCount;
            analysis.globalTransformationStatus.untransformed += validation.untransformedCount;
            analysis.globalTransformationStatus.unknown += validation.unknownCount;
            analysis.criticalIssues += validation.criticalIssues;
            analysis.warnings += validation.warnings;
            
            // Track coordinate ranges by layer type
            if (validation.coordinateRanges) {
                const type = layer.type;
                if (!analysis.coordinateRangesByType[type]) {
                    analysis.coordinateRangesByType[type] = [];
                }
                analysis.coordinateRangesByType[type].push({
                    layer: layerName,
                    ranges: validation.coordinateRanges
                });
            }
        });
        
        // Check for alignment issues between different layer types
        const typeEntries = Object.entries(analysis.coordinateRangesByType);
        for (let i = 0; i < typeEntries.length; i++) {
            for (let j = i + 1; j < typeEntries.length; j++) {
                const [type1, ranges1] = typeEntries[i];
                const [type2, ranges2] = typeEntries[j];
                
                // Calculate average centers for each type
                const center1 = this.calculateAverageCenter(ranges1.map(r => r.ranges));
                const center2 = this.calculateAverageCenter(ranges2.map(r => r.ranges));
                
                const distance = Math.sqrt(
                    Math.pow(center1.x - center2.x, 2) + 
                    Math.pow(center1.y - center2.y, 2)
                );
                
                if (distance > 50) { // 50mm separation indicates alignment issue
                    analysis.alignmentIssues.push({
                        type1, type2,
                        distance: distance,
                        center1, center2,
                        message: `${type1} and ${type2} layers appear misaligned (${distance.toFixed(1)}mm apart)`
                    });
                }
            }
        }
        
        return analysis;
    }
    
    /**
     * Helper method to calculate average center from coordinate ranges
     */
    calculateAverageCenter(ranges) {
        if (ranges.length === 0) return { x: 0, y: 0 };
        
        let totalCenterX = 0, totalCenterY = 0;
        ranges.forEach(range => {
            totalCenterX += (range.minX + range.maxX) / 2;
            totalCenterY += (range.minY + range.maxY) / 2;
        });
        
        return {
            x: totalCenterX / ranges.length,
            y: totalCenterY / ranges.length
        };
    }
    
    clearLayers() {
        this.layers.clear();
        this.validationResults.clear();
        this.renderingIssues = [];
        this.bounds = null;
        this.render();
    }
    
    calculateLayerBounds(primitives) {
        if (!primitives || primitives.length === 0) {
            return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
        }
        
        let minX = Infinity, minY = Infinity;
        let maxX = -Infinity, maxY = -Infinity;
        
        primitives.forEach(primitive => {
            const bounds = primitive.getBounds();
            minX = Math.min(minX, bounds.minX);
            minY = Math.min(minY, bounds.minY);
            maxX = Math.max(maxX, bounds.maxX);
            maxY = Math.max(maxY, bounds.maxY);
        });
        
        return { minX, minY, maxX, maxY };
    }
    
    calculateOverallBounds() {
        let minX = Infinity, minY = Infinity;
        let maxX = -Infinity, maxY = -Infinity;
        let hasData = false;
        
        this.layers.forEach(layer => {
            if (layer.visible && layer.bounds) {
                minX = Math.min(minX, layer.bounds.minX);
                minY = Math.min(minY, layer.bounds.minY);
                maxX = Math.max(maxX, layer.bounds.maxX);
                maxY = Math.max(maxY, layer.bounds.maxY);
                hasData = true;
            }
        });
        
        if (hasData) {
            this.bounds = {
                minX, minY, maxX, maxY,
                width: maxX - minX,
                height: maxY - minY,
                centerX: (minX + maxX) / 2,
                centerY: (minY + maxY) / 2
            };
        } else {
            this.bounds = null;
        }
    }
    
    render() {
        const startTime = performance.now();
        this.renderStats.primitives = 0;
        this.renderStats.coordinateIssues = 0;
        this.renderStats.transformedPrimitives = 0;
        this.renderStats.untransformedPrimitives = 0;
        this.renderingIssues = [];
        
        // Clear canvas
        const colors = this.colors[this.options.theme];
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.ctx.fillStyle = colors.background;
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        
        this.ctx.save();
        
        // Apply view transformation
        this.ctx.translate(this.viewOffset.x, this.viewOffset.y);
        this.ctx.scale(this.viewScale, -this.viewScale); // Flip Y for PCB coordinates
        
        // Render background elements
        if (this.options.showGrid) this.renderGrid();
        if (this.options.showBounds && this.bounds) this.renderBounds();
        
        // Render layers in order with proper colors
        const renderOrder = ['cutout', 'clear', 'isolation', 'drill'];
        
        renderOrder.forEach(type => {
            this.layers.forEach(layer => {
                if (layer.visible && layer.type === type) {
                    if (this.options.showOriginal || layer.isOffset) {
                        this.renderLayer(layer);
                    }
                }
            });
        });
        
        // Render origin marker ALWAYS ON TOP
        if (this.options.showOrigin) this.renderOrigin();
        
        this.ctx.restore();
        
        // Render screen-space elements
        if (this.options.showRulers) this.renderRulers();
        this.renderScaleIndicator();
        
        const endTime = performance.now();
        this.renderStats.renderTime = endTime - startTime;
        
        if (this.options.debug) {
            this.renderDebugInfo();
            this.renderCoordinateValidationInfo();
        }
    }
    
    renderLayer(layer) {
        const colors = this.colors[this.options.theme];
        
        // Determine layer color with proper mapping
        let layerColor;
        if (layer.color) {
            layerColor = layer.color;
        } else {
            switch (layer.type) {
                case 'isolation': layerColor = colors.isolation; break;
                case 'clear': layerColor = colors.clear; break;
                case 'drill': layerColor = colors.drill; break;
                case 'cutout': layerColor = colors.cutout; break;
                default: layerColor = colors.copper; break;
            }
        }
        
        layer.primitives.forEach(primitive => {
            this.renderStats.primitives++;
            
            // Check transformation status for statistics
            const wasTransformed = primitive.wasTransformedDuringCreation?.() || false;
            if (wasTransformed === true) {
                this.renderStats.transformedPrimitives++;
            } else if (wasTransformed === false) {
                this.renderStats.untransformedPrimitives++;
            }
            
            // FIXED: Simplified geometry type filtering for cutout layers
            if (!this.shouldRenderPrimitive(primitive, layer.type)) {
                return; // Skip this primitive based on user preferences
            }
            
            // Skip primitives with invalid bounds
            const bounds = primitive.getBounds();
            if (!isFinite(bounds.minX) || !isFinite(bounds.minY) || 
                !isFinite(bounds.maxX) || !isFinite(bounds.maxY)) {
                this.renderStats.coordinateIssues++;
                this.renderingIssues.push({
                    type: 'invalid_bounds',
                    primitive: primitive,
                    layer: layer.name
                });
                return; // Skip rendering this primitive
            }
            
            let fillColor = layerColor;
            let strokeColor = layerColor;
            
            if (primitive.properties.isNonConductor) {
                fillColor = colors.nonConductor;
                strokeColor = colors.nonConductor;
            }
            
            if (this.options.blackAndWhite) {
                const bwColor = this.options.theme === 'dark' ? '#ffffff' : '#000000';
                fillColor = bwColor;
                strokeColor = bwColor;
            }
            
            // Render primitive with current coordinates
            this.renderPrimitive(primitive, fillColor, strokeColor);
        });
    }
    
    /**
     * FIXED: Aggressive cutout filtering to eliminate contamination
     */
    shouldRenderPrimitive(primitive, layerType) {
        // FIXED: Very aggressive cutout layer filtering
        if (layerType === 'cutout') {
            // Only show if cutouts are enabled
            if (!this.options.showCutouts) {
                if (this.options.debug) {
                    console.log(`[Cutout Filter] HIDDEN: showCutouts disabled`);
                }
                return false;
            }
            
            // AGGRESSIVE: Only show closed paths (board outlines must be closed)
            if (primitive.type !== 'path' || !primitive.closed) {
                if (this.options.debug) {
                    console.log(`[Cutout Filter] HIDDEN: type=${primitive.type}, closed=${primitive.closed || false} (only closed paths allowed)`);
                }
                return false;
            }
            
            // Check size - board outlines should be substantial
            const bounds = primitive.getBounds();
            const width = bounds.maxX - bounds.minX;
            const height = bounds.maxY - bounds.minY;
            const perimeter = Math.max(width, height);
            const area = width * height;
            
            // AGGRESSIVE: Board outlines should be large (>20mm in at least one dimension and >100mm² area)
            if (perimeter < 20 || area < 100) {
                if (this.options.debug) {
                    console.log(`[Cutout Filter] HIDDEN: size too small - ${width.toFixed(1)} × ${height.toFixed(1)} mm (area: ${area.toFixed(1)}mm²)`);
                }
                return false;
            }
            
            // AGGRESSIVE: Reject anything marked as text, stroke, or non-conductor
            if (primitive.properties.isText || 
                primitive.properties.isStroke || 
                primitive.properties.isNonConductor ||
                primitive.properties.function === 'Legend') {
                if (this.options.debug) {
                    console.log(`[Cutout Filter] HIDDEN: unwanted properties - text:${!!primitive.properties.isText}, stroke:${!!primitive.properties.isStroke}, nonConductor:${!!primitive.properties.isNonConductor}, function:${primitive.properties.function}`);
                }
                return false;
            }
            
            // AGGRESSIVE: Only rectangular-ish board outlines (aspect ratio between 0.1 and 10)
            const aspectRatio = width / height;
            if (aspectRatio < 0.1 || aspectRatio > 10) {
                if (this.options.debug) {
                    console.log(`[Cutout Filter] HIDDEN: extreme aspect ratio ${aspectRatio.toFixed(2)} (${width.toFixed(1)} × ${height.toFixed(1)})`);
                }
                return false;
            }
            
            if (this.options.debug) {
                console.log(`[Cutout Filter] SHOWING: closed path ${width.toFixed(1)} × ${height.toFixed(1)} mm, area: ${area.toFixed(1)}mm², aspect: ${aspectRatio.toFixed(2)}`);
            }
            return true;
        }
        
        // For non-cutout layers, apply normal filtering
        
        // Drill holes - controlled by showDrills
        if (primitive.properties.isDrillHole || layerType === 'drill') {
            return this.options.showDrills;
        }
        
        // Traces (strokes) - controlled by showTraces
        if (primitive.properties.isStroke) {
            return this.options.showTraces;
        }
        
        // Pads/Flashes - controlled by showPads
        if (primitive.properties.isFlash || primitive.type === 'circle' || 
            primitive.type === 'rectangle' || primitive.type === 'obround') {
            return this.options.showPads;
        }
        
        // Regions (filled polygons) - controlled by showRegions
        if (primitive.properties.isRegion || 
            (primitive.type === 'path' && primitive.closed && !primitive.properties.isStroke)) {
            return this.options.showRegions;
        }
        
        // Open paths that aren't strokes - also controlled by showTraces
        if (primitive.type === 'path' && !primitive.closed) {
            return this.options.showTraces;
        }
        
        // Default: show if not specifically categorized
        return true;
    }
    
    renderPrimitive(primitive, fillColor, strokeColor) {
        this.ctx.save();
        
        this.ctx.fillStyle = fillColor;
        this.ctx.strokeStyle = strokeColor;
        
        // Enhanced stroke width handling
        if (primitive.properties.isStroke) {
            if (this.options.showFill) {
                this.ctx.lineWidth = 0.05 / this.viewScale;
            } else {
                this.ctx.lineWidth = primitive.properties.originalWidth || (0.1 / this.viewScale);
            }
        } else if (primitive.properties.isDrillHole) {
            this.ctx.lineWidth = 0.1 / this.viewScale;
        } else {
            this.ctx.lineWidth = primitive.properties.strokeWidth || (0.1 / this.viewScale);
        }
        
        switch (primitive.type) {
            case 'path':
                this.renderPath(primitive);
                break;
            case 'circle':
                this.renderCircle(primitive);
                break;
            case 'rectangle':
                this.renderRectangle(primitive);
                break;
            case 'obround':
                this.renderObround(primitive);
                break;
            case 'arc':
                this.renderArc(primitive);
                break;
            case 'composite':
                primitive.primitives.forEach(p => this.renderPrimitive(p, fillColor, strokeColor));
                break;
        }
        
        this.ctx.restore();
    }
    
    renderPath(primitive) {
        if (primitive.points.length < 2) return;
        
        this.ctx.beginPath();
        primitive.points.forEach((point, index) => {
            if (index === 0) {
                this.ctx.moveTo(point.x, point.y);
            } else {
                this.ctx.lineTo(point.x, point.y);
            }
        });
        
        if (primitive.closed) {
            this.ctx.closePath();
        }
        
        // Enhanced stroke primitive rendering
        if (primitive.properties.isStroke) {
            if (this.options.showFill) {
                this.ctx.fill();
                if (this.options.showPads) {
                    this.ctx.save();
                    this.ctx.lineWidth = 0.03 / this.viewScale;
                    this.ctx.globalAlpha = 0.5;
                    this.ctx.stroke();
                    this.ctx.restore();
                }
            } else {
                if (primitive.points.length === 2 && !primitive.closed) {
                    this.ctx.save();
                    this.ctx.setLineDash([0.3 / this.viewScale, 0.3 / this.viewScale]);
                    this.ctx.globalAlpha = 0.8;
                    this.ctx.stroke();
                    this.ctx.restore();
                } else {
                    this.ctx.save();
                    this.ctx.lineWidth = 0.05 / this.viewScale;
                    this.ctx.globalAlpha = 0.7;
                    this.ctx.stroke();
                    this.ctx.restore();
                }
                
                if (this.options.debug && primitive.properties.originalWidth) {
                    this.ctx.save();
                    this.ctx.globalAlpha = 0.2;
                    this.ctx.setLineDash([0.2 / this.viewScale, 0.4 / this.viewScale]);
                    this.ctx.lineWidth = primitive.properties.originalWidth;
                    this.ctx.stroke();
                    this.ctx.restore();
                }
            }
        } else {
            const shouldFill = this.options.showFill && 
                              primitive.properties.fill !== false &&
                              !primitive.properties.isText;
            
            const shouldStroke = this.options.showPads || 
                                primitive.properties.stroke === true ||
                                (!shouldFill && primitive.properties.fill === true);
            
            if (shouldFill) {
                if (primitive.properties.fillRule) {
                    this.ctx.fill(primitive.properties.fillRule);
                } else {
                    this.ctx.fill();
                }
            }
            
            if (shouldStroke) {
                this.ctx.stroke();
            }
        }
    }
    
    renderCircle(primitive) {
        this.ctx.beginPath();
        this.ctx.arc(
            primitive.center.x,
            primitive.center.y,
            primitive.radius,
            0,
            2 * Math.PI
        );
        
        const isDrillHole = primitive.properties.isDrillHole;
        
        const shouldFill = (this.options.showFill && primitive.properties.fill !== false) || 
                          (isDrillHole && this.options.showFill);
        
        const shouldStroke = this.options.showPads || 
                            primitive.properties.stroke === true || 
                            isDrillHole ||
                            (!shouldFill && primitive.properties.fill !== false);
        
        if (shouldFill) {
            this.ctx.fill();
        }
        if (shouldStroke) {
            this.ctx.stroke();
        }
    }
    
    renderRectangle(primitive) {
        const shouldFill = this.options.showFill && primitive.properties.fill !== false;
        const shouldStroke = this.options.showPads || primitive.properties.stroke === true;
        
        if (shouldFill) {
            this.ctx.fillRect(
                primitive.position.x,
                primitive.position.y,
                primitive.width,
                primitive.height
            );
        }
        if (shouldStroke) {
            this.ctx.strokeRect(
                primitive.position.x,
                primitive.position.y,
                primitive.width,
                primitive.height
            );
        }
    }
    
    renderObround(primitive) {
        const x = primitive.position.x;
        const y = primitive.position.y;
        const w = primitive.width;
        const h = primitive.height;
        const r = Math.min(w, h) / 2;
        
        this.ctx.beginPath();
        
        if (w > h) {
            this.ctx.moveTo(x + r, y);
            this.ctx.lineTo(x + w - r, y);
            this.ctx.arc(x + w - r, y + r, r, -Math.PI / 2, Math.PI / 2);
            this.ctx.lineTo(x + r, y + h);
            this.ctx.arc(x + r, y + r, r, Math.PI / 2, -Math.PI / 2);
        } else {
            this.ctx.moveTo(x + w, y + r);
            this.ctx.lineTo(x + w, y + h - r);
            this.ctx.arc(x + r, y + h - r, r, 0, Math.PI);
            this.ctx.lineTo(x, y + r);
            this.ctx.arc(x + r, y + r, r, Math.PI, 0);
        }
        
        this.ctx.closePath();
        
        const shouldFill = this.options.showFill && primitive.properties.fill !== false;
        const shouldStroke = this.options.showPads || primitive.properties.stroke === true;
        
        if (shouldFill) {
            this.ctx.fill();
        }
        if (shouldStroke) {
            this.ctx.stroke();
        }
    }
    
    renderArc(primitive) {
        const radius = Math.sqrt(
            Math.pow(primitive.start.x - primitive.center.x, 2) +
            Math.pow(primitive.start.y - primitive.center.y, 2)
        );
        
        const startAngle = Math.atan2(
            primitive.start.y - primitive.center.y,
            primitive.start.x - primitive.center.x
        );
        const endAngle = Math.atan2(
            primitive.end.y - primitive.center.y,
            primitive.end.x - primitive.center.x
        );
        
        this.ctx.beginPath();
        this.ctx.arc(
            primitive.center.x,
            primitive.center.y,
            radius,
            startAngle,
            endAngle,
            !primitive.clockwise
        );
        
        if (this.options.showPads || primitive.properties.stroke === true) {
            this.ctx.stroke();
        }
    }
    
    renderGrid() {
        const colors = this.colors[this.options.theme];
        const gridSpacing = this.calculateGridSpacing();
        const viewBounds = this.getViewBounds();
        
        this.ctx.strokeStyle = colors.grid;
        this.ctx.lineWidth = 0.1 / this.viewScale;
        this.ctx.setLineDash([]);
        
        this.ctx.beginPath();
        
        // PROFESSIONAL: Grid aligned to current origin position
        const originX = this.originPosition.x;
        const originY = this.originPosition.y;
        
        // Adjust grid start positions to align with origin
        const startX = Math.floor((viewBounds.minX - originX) / gridSpacing) * gridSpacing + originX;
        const endX = Math.ceil((viewBounds.maxX - originX) / gridSpacing) * gridSpacing + originX;
        
        for (let x = startX; x <= endX; x += gridSpacing) {
            this.ctx.moveTo(x, viewBounds.minY);
            this.ctx.lineTo(x, viewBounds.maxY);
        }
        
        const startY = Math.floor((viewBounds.minY - originY) / gridSpacing) * gridSpacing + originY;
        const endY = Math.ceil((viewBounds.maxY - originY) / gridSpacing) * gridSpacing + originY;
        
        for (let y = startY; y <= endY; y += gridSpacing) {
            this.ctx.moveTo(viewBounds.minX, y);
            this.ctx.lineTo(viewBounds.maxX, y);
        }
        
        this.ctx.stroke();
    }
    
    /**
     * PROFESSIONAL: Enhanced origin marker that renders at the coordinate system position
     */
    renderOrigin() {
        const colors = this.colors[this.options.theme];
        
        // Make marker bigger and more visible
        const markerSize = 10 / this.viewScale;
        const circleSize = 3 / this.viewScale;
        const strokeWidth = 3 / this.viewScale;
        
        // Draw origin at coordinate system position
        const originX = this.originPosition.x;
        const originY = this.originPosition.y;
        
        // Draw outline for better visibility
        this.ctx.strokeStyle = colors.originOutline;
        this.ctx.lineWidth = strokeWidth + (1 / this.viewScale);
        
        // Draw crosshair outline at origin position
        this.ctx.beginPath();
        this.ctx.moveTo(originX - markerSize, originY);
        this.ctx.lineTo(originX + markerSize, originY);
        this.ctx.moveTo(originX, originY - markerSize);
        this.ctx.lineTo(originX, originY + markerSize);
        this.ctx.stroke();
        
        // Draw circle outline
        this.ctx.beginPath();
        this.ctx.arc(originX, originY, circleSize, 0, 2 * Math.PI);
        this.ctx.stroke();
        
        // Draw main crosshair
        this.ctx.strokeStyle = colors.origin;
        this.ctx.lineWidth = strokeWidth;
        
        this.ctx.beginPath();
        this.ctx.moveTo(originX - markerSize, originY);
        this.ctx.lineTo(originX + markerSize, originY);
        this.ctx.moveTo(originX, originY - markerSize);
        this.ctx.lineTo(originX, originY + markerSize);
        this.ctx.stroke();
        
        // Draw center circle
        this.ctx.beginPath();
        this.ctx.arc(originX, originY, circleSize, 0, 2 * Math.PI);
        this.ctx.stroke();
        
        // Fill center circle for better visibility
        this.ctx.fillStyle = colors.origin;
        this.ctx.fill();
    }
    
    renderBounds() {
        const colors = this.colors[this.options.theme];
        this.ctx.strokeStyle = colors.bounds;
        this.ctx.lineWidth = 1 / this.viewScale;
        this.ctx.setLineDash([2 / this.viewScale, 2 / this.viewScale]);
        this.ctx.strokeRect(
            this.bounds.minX,
            this.bounds.minY,
            this.bounds.width,
            this.bounds.height
        );
        
        // Add corner markers
        const markerSize = 5 / this.viewScale;
        this.ctx.setLineDash([]);
        this.ctx.lineWidth = 2 / this.viewScale;
        
        // Bottom-left corner
        this.ctx.beginPath();
        this.ctx.moveTo(this.bounds.minX, this.bounds.minY + markerSize);
        this.ctx.lineTo(this.bounds.minX, this.bounds.minY);
        this.ctx.lineTo(this.bounds.minX + markerSize, this.bounds.minY);
        this.ctx.stroke();
        
        // Top-right corner
        this.ctx.beginPath();
        this.ctx.moveTo(this.bounds.maxX - markerSize, this.bounds.maxY);
        this.ctx.lineTo(this.bounds.maxX, this.bounds.maxY);
        this.ctx.lineTo(this.bounds.maxX, this.bounds.maxY - markerSize);
        this.ctx.stroke();
    }
    
    // PROFESSIONAL: Rulers that show coordinates relative to current origin position
    renderRulers() {
        this.ctx.save();
        this.ctx.setTransform(1, 0, 0, 1, 0, 0);
        
        const colors = this.colors[this.options.theme];
        this.ctx.strokeStyle = colors.ruler;
        this.ctx.fillStyle = colors.rulerText;
        this.ctx.lineWidth = 1;
        this.ctx.font = '12px Arial';
        this.ctx.textBaseline = 'top';
        this.ctx.textAlign = 'left';
        
        const rulerSize = 20;
        const tickLength = 5;
        const majorStep = this.calculateRulerStep();
        const viewBounds = this.getViewBounds();
        
        // X-axis ruler (top)
        this.ctx.beginPath();
        this.ctx.moveTo(rulerSize, rulerSize);
        this.ctx.lineTo(this.canvas.width, rulerSize);
        this.ctx.stroke();
        
        this.ctx.textAlign = 'center';
        
        // PROFESSIONAL: Calculate coordinates relative to origin position
        const originX = this.originPosition.x;
        const originY = this.originPosition.y;
        
        // Align ruler ticks to origin
        const startXWorld = Math.floor((viewBounds.minX - originX) / majorStep) * majorStep + originX;
        const endXWorld = Math.ceil((viewBounds.maxX - originX) / majorStep) * majorStep + originX;
        
        for (let xWorld = startXWorld; xWorld <= endXWorld; xWorld += majorStep) {
            const xCanvas = this.worldToCanvasX(xWorld);
            if (xCanvas >= rulerSize && xCanvas <= this.canvas.width) {
                this.ctx.moveTo(xCanvas, rulerSize);
                this.ctx.lineTo(xCanvas, rulerSize - tickLength);
                
                // Show coordinates relative to current origin
                const relativeX = xWorld - originX;
                let label;
                if (majorStep < 0.1) {
                    label = `${(relativeX * 1000).toFixed(0)}μm`;
                } else {
                    const precision = majorStep < 0.1 ? 3 : majorStep < 1 ? 2 : 1;
                    label = relativeX.toFixed(precision);
                }
                this.ctx.fillText(label, xCanvas, 0);
            }
        }
        this.ctx.stroke();
        
        // Y-axis ruler (left)
        this.ctx.beginPath();
        this.ctx.moveTo(rulerSize, 0);
        this.ctx.lineTo(rulerSize, this.canvas.height);
        this.ctx.stroke();
        
        this.ctx.textAlign = 'left';
        this.ctx.textBaseline = 'middle';
        
        // Align ruler ticks to origin
        const startYWorld = Math.floor((viewBounds.minY - originY) / majorStep) * majorStep + originY;
        const endYWorld = Math.ceil((viewBounds.maxY - originY) / majorStep) * majorStep + originY;
        
        for (let yWorld = startYWorld; yWorld <= endYWorld; yWorld += majorStep) {
            const yCanvas = this.worldToCanvasY(yWorld);
            if (yCanvas >= 0 && yCanvas <= this.canvas.height) {
                this.ctx.moveTo(rulerSize, yCanvas);
                this.ctx.lineTo(rulerSize - tickLength, yCanvas);
                
                // Show coordinates relative to current origin
                const relativeY = yWorld - originY;
                let label;
                if (majorStep < 0.1) {
                    label = `${(relativeY * 1000).toFixed(0)}μm`;
                } else {
                    const precision = majorStep < 0.1 ? 3 : majorStep < 1 ? 2 : 1;
                    label = relativeY.toFixed(precision);
                }
                this.ctx.fillText(label, tickLength + 2, yCanvas);
            }
        }
        this.ctx.stroke();
        
        // Corner square
        this.ctx.fillStyle = colors.background;
        this.ctx.fillRect(0, 0, rulerSize, rulerSize);
        this.ctx.strokeRect(0, 0, rulerSize, rulerSize);
        
        this.ctx.restore();
    }
    
    renderScaleIndicator() {
        this.ctx.save();
        this.ctx.setTransform(1, 0, 0, 1, 0, 0);
        
        const colors = this.colors[this.options.theme];
        const padding = 10;
        const barHeight = 4;
        const y = this.canvas.height - padding - 20;
        
        // Determine scale bar length
        const targetPixels = 100;
        const worldLength = targetPixels / this.viewScale;
        
        const possibleLengths = [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100];
        const niceLength = possibleLengths.find(len => len * this.viewScale >= 50) || 1;
        const barWidth = niceLength * this.viewScale;
        
        const x = this.canvas.width - padding - barWidth;
        
        // Background for contrast
        this.ctx.fillStyle = colors.background;
        this.ctx.globalAlpha = 0.8;
        this.ctx.fillRect(x - 5, y - 20, barWidth + 10, 30);
        this.ctx.globalAlpha = 1;
        
        // Draw scale bar
        this.ctx.fillStyle = colors.rulerText;
        this.ctx.fillRect(x, y, barWidth, barHeight);
        
        // Draw end caps
        this.ctx.fillRect(x, y - 2, 1, barHeight + 4);
        this.ctx.fillRect(x + barWidth - 1, y - 2, 1, barHeight + 4);
        
        // Draw label
        this.ctx.font = '11px Arial';
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'bottom';
        let label;
        if (niceLength < 0.01) {
            label = `${(niceLength * 1000).toFixed(0)}μm`;
        } else if (niceLength < 1) {
            label = `${niceLength.toFixed(2)}mm`;
        } else {
            label = `${niceLength}mm`;
        }
        this.ctx.fillText(label, x + barWidth / 2, y - 2);
        
        this.ctx.restore();
    }
    
    /**
     * Render debug information including coordinate validation
     */
    renderDebugInfo() {
        this.ctx.save();
        this.ctx.setTransform(1, 0, 0, 1, 0, 0);
        
        const colors = this.colors[this.options.theme];
        this.ctx.fillStyle = colors.rulerText;
        this.ctx.font = '12px monospace';
        this.ctx.textAlign = 'left';
        this.ctx.textBaseline = 'top';
        
        const info = [
            `Primitives: ${this.renderStats.primitives}`,
            `Render: ${this.renderStats.renderTime.toFixed(1)}ms`,
            `Scale: ${this.viewScale.toFixed(2)}×`,
            `Offset: (${this.viewOffset.x.toFixed(0)}, ${this.viewOffset.y.toFixed(0)})`,
            `Layers: ${this.layers.size}`,
            `Coord Issues: ${this.renderStats.coordinateIssues}`,
            `PROFESSIONAL MODE`,
            `Origin: (${this.originPosition.x.toFixed(1)}, ${this.originPosition.y.toFixed(1)})`
        ];
        
        const x = 30;
        let y = this.canvas.height - 140;
        
        info.forEach(line => {
            this.ctx.fillText(line, x, y);
            y += 15;
        });
        
        this.ctx.restore();
    }
    
    /**
     * Render coordinate validation information
     */
    renderCoordinateValidationInfo() {
        if (this.renderingIssues.length === 0) return;
        
        this.ctx.save();
        this.ctx.setTransform(1, 0, 0, 1, 0, 0);
        
        const colors = this.colors[this.options.theme];
        this.ctx.fillStyle = '#ff4444'; // Red for issues
        this.ctx.font = '11px monospace';
        this.ctx.textAlign = 'left';
        this.ctx.textBaseline = 'top';
        
        const x = this.canvas.width - 300;
        let y = 30;
        
        this.ctx.fillText('⚠️ COORDINATE ISSUES:', x, y);
        y += 15;
        
        this.renderingIssues.slice(0, 5).forEach(issue => { // Show max 5 issues
            this.ctx.fillText(`${issue.type} in ${issue.layer}`, x, y);
            y += 12;
        });
        
        if (this.renderingIssues.length > 5) {
            this.ctx.fillText(`... +${this.renderingIssues.length - 5} more`, x, y);
        }
        
        this.ctx.restore();
    }
    
    // Coordinate conversion methods
    calculateGridSpacing() {
        const minPixelSize = 40;
        const possibleSteps = [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100];
        return possibleSteps.find(step => step * this.viewScale >= minPixelSize) || 100;
    }
    
    calculateRulerStep() {
        const minPixelDistance = 50;
        const possibleSteps = [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100];
        return possibleSteps.find(step => step * this.viewScale >= minPixelDistance) || 100;
    }
    
    getViewBounds() {
        const topLeft = this.canvasToWorld(0, 0);
        const bottomRight = this.canvasToWorld(this.canvas.width, this.canvas.height);
        
        return {
            minX: Math.min(topLeft.x, bottomRight.x),
            maxX: Math.max(topLeft.x, bottomRight.x),
            minY: Math.min(topLeft.y, bottomRight.y),
            maxY: Math.max(topLeft.y, bottomRight.y)
        };
    }
    
    worldToCanvasX(worldX) {
        return this.viewOffset.x + worldX * this.viewScale;
    }
    
    worldToCanvasY(worldY) {
        return this.viewOffset.y - worldY * this.viewScale;
    }
    
    canvasToWorld(canvasX, canvasY) {
        return {
            x: (canvasX - this.viewOffset.x) / this.viewScale,
            y: -(canvasY - this.viewOffset.y) / this.viewScale
        };
    }
    
    // PROFESSIONAL: Coordinate system interface
    setCoordinateSystem(coordinateSystem) {
        this.coordinateSystem = coordinateSystem;
        console.log('PROFESSIONAL: Coordinate system linked to renderer');
    }
    
    setOriginPosition(x, y) {
        // Update origin position for rendering
        this.originPosition.x = x;
        this.originPosition.y = y;
        this.render();
    }
    
    getOriginPosition() {
        return { ...this.originPosition };
    }
    
    getCoordinateSystem() {
        return this.coordinateSystem;
    }
    
    // Zoom to cursor position (not origin)
    zoomIn(cursorX = null, cursorY = null) {
        this.setZoom(this.viewScale * 1.2, cursorX, cursorY);
    }
    
    zoomOut(cursorX = null, cursorY = null) {
        this.setZoom(this.viewScale / 1.2, cursorX, cursorY);
    }
    
    setZoom(newScale, centerX = null, centerY = null) {
        const oldScale = this.viewScale;
        this.viewScale = Math.max(this.minZoom, Math.min(this.maxZoom, newScale));
        
        // Default to canvas center if no cursor position provided
        if (centerX === null) centerX = this.canvas.width / 2;
        if (centerY === null) centerY = this.canvas.height / 2;
        
        // Calculate world point at zoom center using proper coordinate conversion
        const worldCenterX = (centerX - this.viewOffset.x) / oldScale;
        const worldCenterY = -(centerY - this.viewOffset.y) / oldScale;
        
        // Apply scale change to view offset
        const scaleFactor = this.viewScale / oldScale;
        this.viewOffset.x = this.viewOffset.x * scaleFactor;
        this.viewOffset.y = this.viewOffset.y * scaleFactor;
        
        // Calculate where the world center point is now in canvas coordinates
        const newCanvasX = this.viewOffset.x + worldCenterX * this.viewScale;
        const newCanvasY = this.viewOffset.y - worldCenterY * this.viewScale;
        
        // Adjust offset to keep the world center at the same canvas position
        this.viewOffset.x += centerX - newCanvasX;
        this.viewOffset.y += centerY - newCanvasY;
        
        this.render();
    }
    
    pan(dx, dy) {
        this.viewOffset.x += dx;
        this.viewOffset.y += dy;
        this.render();
    }
    
    // Better zoom fit with proper padding
    zoomFit() {
        this.calculateOverallBounds();
        if (!this.bounds) {
            // No content - center on origin with reasonable zoom
            this.viewScale = 10;
            this.viewOffset = { 
                x: this.canvas.width / 2, 
                y: this.canvas.height / 2 
            };
            this.render();
            return;
        }
        
        const padding = 0.1; // 10% padding
        const desiredWidth = this.bounds.width * (1 + padding * 2);
        const desiredHeight = this.bounds.height * (1 + padding * 2);
        
        // Ensure minimum zoom for small boards
        const minZoom = 1;
        const scaleX = Math.max(minZoom, this.canvas.width / desiredWidth);
        const scaleY = Math.max(minZoom, this.canvas.height / desiredHeight);
        this.viewScale = Math.min(scaleX, scaleY);
        
        // Center the board bounds in the canvas
        this.viewOffset.x = this.canvas.width / 2 - this.bounds.centerX * this.viewScale;
        this.viewOffset.y = this.canvas.height / 2 + this.bounds.centerY * this.viewScale;
        
        this.render();
    }
    
    // Event handling with proper cursor management
    setupEventListeners() {
        let isPanning = false;
        let lastX, lastY;
        
        // Prevent image dragging and ensure proper cursor styles
        this.canvas.style.cursor = 'grab';
        this.canvas.style.userSelect = 'none';
        this.canvas.style.webkitUserSelect = 'none';
        this.canvas.style.mozUserSelect = 'none';
        this.canvas.style.msUserSelect = 'none';
        
        // Prevent context menu and image dragging
        this.canvas.addEventListener('contextmenu', (e) => {
            e.preventDefault();
        });
        
        this.canvas.addEventListener('dragstart', (e) => {
            e.preventDefault();
        });
        
        this.canvas.addEventListener('mousedown', (e) => {
            if (e.button === 0) { // Left mouse button only
                e.preventDefault();
                isPanning = true;
                lastX = e.clientX;
                lastY = e.clientY;
                this.canvas.style.cursor = 'grabbing';
            }
        });
        
        this.canvas.addEventListener('mousemove', (e) => {
            if (isPanning) {
                e.preventDefault();
                const dx = e.clientX - lastX;
                const dy = e.clientY - lastY;
                this.pan(dx, dy);
                lastX = e.clientX;
                lastY = e.clientY;
            }
        });
        
        // Handle mouse up on document to catch mouse release outside canvas
        document.addEventListener('mouseup', (e) => {
            if (isPanning) {
                isPanning = false;
                this.canvas.style.cursor = 'grab';
            }
        });
        
        this.canvas.addEventListener('mouseleave', () => {
            // Don't change isPanning state on leave - let document mouseup handle it
        });
        
        // Zoom to cursor position with proper coordinate handling
        this.canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            
            // Get cursor position relative to canvas
            const rect = this.canvas.getBoundingClientRect();
            const cursorX = e.clientX - rect.left;
            const cursorY = e.clientY - rect.top;
            
            const scaleAmount = 1.1;
            
            if (e.deltaY < 0) {
                this.setZoom(this.viewScale * scaleAmount, cursorX, cursorY);
            } else {
                this.setZoom(this.viewScale / scaleAmount, cursorX, cursorY);
            }
        });
        
        // Double-click to fit
        this.canvas.addEventListener('dblclick', (e) => {
            e.preventDefault();
            this.zoomFit();
        });
        
        // Handle resize
        this.resizeObserver = new ResizeObserver(() => {
            this.resizeCanvas();
        });
        this.resizeObserver.observe(this.canvas);
    }
    
    resizeCanvas() {
        const parent = this.canvas.parentElement;
        if (parent) {
            this.canvas.width = parent.clientWidth;
            this.canvas.height = parent.clientHeight;
            this.render();
        }
    }
}

// Export coordinate validation function for global access
window.validateRendererCoordinates = function() {
    if (!window.cam?.renderer) {
        console.log('❌ No renderer available');
        return;
    }
    
    console.log('🔍 PROFESSIONAL: RENDERER COORDINATE VALIDATION');
    console.log('==================================================');
    
    const analysis = window.cam.renderer.validateCoordinateConsistency();
    
    console.log(`📊 Analysis Results:`);
    console.log(`  Total layers: ${analysis.totalLayers}`);
    console.log(`  Total primitives: ${analysis.totalPrimitives}`);
    console.log(`  Transformation status:`, analysis.globalTransformationStatus);
    console.log(`  Critical issues: ${analysis.criticalIssues}`);
    console.log(`  Warnings: ${analysis.warnings}`);
    
    if (analysis.alignmentIssues.length > 0) {
        console.log(`\n❌ ALIGNMENT ISSUES DETECTED:`);
        analysis.alignmentIssues.forEach(issue => {
            console.log(`• ${issue.message}`);
            console.log(`  ${issue.type1} center: (${issue.center1.x.toFixed(1)}, ${issue.center1.y.toFixed(1)})`);
            console.log(`  ${issue.type2} center: (${issue.center2.x.toFixed(1)}, ${issue.center2.y.toFixed(1)})`);
        });
    } else {
        console.log(`\n✅ No alignment issues detected`);
    }
    
    // Show coordinate ranges by type
    console.log(`\n📍 Coordinate ranges by type:`);
    Object.entries(analysis.coordinateRangesByType).forEach(([type, ranges]) => {
        console.log(`  ${type.toUpperCase()}:`);
        ranges.forEach(range => {
            const r = range.ranges;
            console.log(`    ${range.layer}: (${r.minX.toFixed(1)}, ${r.minY.toFixed(1)}) to (${r.maxX.toFixed(1)}, ${r.maxY.toFixed(1)})`);
        });
    });
    
    return analysis;
};

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = LayerRenderer;
} else {
    window.LayerRenderer = LayerRenderer;
}