// renderer/canvas-renderer.js - Canvas rendering engine with FIXED SVG export
// Handles pure rendering operations without interaction logic

class CanvasRenderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        if (!this.ctx) {
            throw new Error('Could not get 2D context from canvas');
        }
        
        // View state
        this.viewOffset = { x: 0, y: 0 };
        this.viewScale = 1;
        this.bounds = null;
        
        // Track origin position and rotation
        this.originPosition = { x: 0, y: 0 };
        this.currentRotation = 0;
        this.rotationCenter = { x: 0, y: 0 };
        
        // Enhanced color schemes
        this.colors = {
            dark: {
                background: '#1a1a1a',
                isolation: '#ff8844',    // Orange for isolation routing
                clear: '#44ff88',        // Green for copper clearing  
                drill: '#4488ff',        // Blue for drilling
                cutout: '#ff00ff',       // Magenta for board cutout
                copper: '#ff8844',       // Fallback copper color
                fused: '#00ff00',        // Green for fused geometry
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
                fused: '#00aa00',        // Dark green for fused geometry
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
        
        // Render options
        this.options = {
            showWireframe: false,
            showPads: true,
            blackAndWhite: false,
            showGrid: true,
            showOrigin: true,
            showBounds: false,
            showRulers: true,
            fuseGeometry: false,
            // Geometry type controls
            showRegions: true,
            showTraces: true,
            showDrills: true,
            showCutouts: true,
            theme: 'dark'
        };
        
        // Stats
        this.renderStats = {
            primitives: 0,
            renderTime: 0,
            skippedPrimitives: 0,
            renderedPrimitives: 0,
            lastSignificantChange: null
        };
        
        this.resizeCanvas();
    }
    
    setOptions(options) {
        const oldOptions = { ...this.options };
        Object.assign(this.options, options);
        
        // Log only if options actually changed
        const changed = Object.keys(options).some(key => oldOptions[key] !== options[key]);
        if (changed) {
            console.log('Renderer options updated:', options);
            this.renderStats.lastSignificantChange = 'options';
        }
        
        this.render();
    }
    
    addLayer(name, primitives, options = {}) {
        console.log(`Adding layer "${name}" with ${primitives.length} primitives`);
        
        this.layers.set(name, {
            name: name,
            primitives: primitives,
            visible: options.visible !== false,
            type: options.type || 'copper',
            bounds: options.bounds || this.calculateLayerBounds(primitives),
            color: options.color || null,
            isFused: options.isFused || false
        });
        
        this.calculateOverallBounds();
        this.renderStats.lastSignificantChange = 'layer-added';
        this.render();
    }
    
    clearLayers() {
        const layerCount = this.layers.size;
        if (layerCount > 0) {
            console.log(`Clearing ${layerCount} layers`);
            this.renderStats.lastSignificantChange = 'layers-cleared';
        }
        this.layers.clear();
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
        
        if (hasData && isFinite(minX) && isFinite(minY) && isFinite(maxX) && isFinite(maxY)) {
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
    
    // [... keeping all the render, renderLayer, renderPrimitive methods unchanged ...]
    
    render() {
        const startTime = performance.now();
        this.renderStats.primitives = 0;
        this.renderStats.skippedPrimitives = 0;
        this.renderStats.renderedPrimitives = 0;
        
        // Clear canvas
        const colors = this.colors[this.options.theme];
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.ctx.fillStyle = colors.background;
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        
        this.ctx.save();
        
        // Apply view transformation
        this.ctx.translate(this.viewOffset.x, this.viewOffset.y);
        this.ctx.scale(this.viewScale, -this.viewScale); // Flip Y for PCB coordinates
        
        // Apply board rotation around rotation center
        if (this.currentRotation !== 0) {
            this.ctx.translate(this.rotationCenter.x, this.rotationCenter.y);
            this.ctx.rotate((this.currentRotation * Math.PI) / 180);
            this.ctx.translate(-this.rotationCenter.x, -this.rotationCenter.y);
        }
        
        // Set line cap and join for better trace rendering
        this.ctx.lineCap = 'round';
        this.ctx.lineJoin = 'round';
        
        // Render background elements
        if (this.options.showGrid) this.renderGrid();
        if (this.options.showBounds && this.bounds) this.renderBounds();
        
        // Separate fused and regular layers
        const fusedLayers = [];
        const regularLayers = [];
        
        this.layers.forEach((layer, name) => {
            if (layer.isFused) {
                fusedLayers.push(layer);
            } else {
                regularLayers.push(layer);
            }
        });
        
        if (fusedLayers.length > 0 && this.renderStats.lastSignificantChange) {
            console.log(`Rendering ${fusedLayers.length} fused layer(s)`);
        }
        fusedLayers.forEach(layer => {
            if (layer.visible) {
                this.renderLayerDirect(layer);
            }
        });
        
        if (regularLayers.length > 0) {
            // Render regular layers in proper order
            const renderOrder = ['cutout', 'clear', 'isolation', 'drill'];
            
            renderOrder.forEach(type => {
                regularLayers.forEach(layer => {
                    if (layer.visible && layer.type === type) {
                        this.renderLayer(layer);
                    }
                });
            });
        }
        
        this.ctx.restore();
        
        // Render origin marker AFTER rotation (always screen-aligned)
        this.ctx.save();
        this.ctx.translate(this.viewOffset.x, this.viewOffset.y);
        this.ctx.scale(this.viewScale, -this.viewScale);
        if (this.options.showOrigin) this.renderOrigin();
        this.ctx.restore();
        
        // Render screen-space elements
        if (this.options.showRulers) this.renderRulers();
        this.renderScaleIndicator();
        
        const endTime = performance.now();
        this.renderStats.renderTime = endTime - startTime;
        
        // Only log on significant changes, not on every pan/zoom
        if (this.renderStats.lastSignificantChange) {
            console.log(`Rendered ${this.renderStats.renderedPrimitives} primitives (${this.renderStats.lastSignificantChange})`);
            this.renderStats.lastSignificantChange = null;
        }
    }
    
    // [... keeping all other rendering methods unchanged until exportSVG ...]
    
    // FIXED: Optimized SVG Export with path combining
    exportSVG(options = {}) {
        console.log('Starting optimized SVG export...');
        
        if (!this.bounds || this.layers.size === 0) {
            console.warn('No content to export');
            return null;
        }
        
        const padding = options.padding || 5;
        const precision = options.precision || 2; // Reduced precision for smaller files
        
        // Calculate SVG dimensions - flip Y axis for SVG coordinate system
        const svgWidth = this.bounds.width + (padding * 2);
        const svgHeight = this.bounds.height + (padding * 2);
        const viewBoxMinX = this.bounds.minX - padding;
        const viewBoxMinY = -(this.bounds.maxY + padding); // Flip Y
        
        // Build SVG content
        const svgParts = [];
        
        // Simplified SVG header without DOCTYPE for better compatibility
        svgParts.push('<?xml version="1.0" encoding="UTF-8"?>');
        svgParts.push('<svg');
        svgParts.push('  xmlns="http://www.w3.org/2000/svg"');
        svgParts.push('  version="1.1"');
        svgParts.push(`  width="${svgWidth.toFixed(precision)}mm"`);
        svgParts.push(`  height="${svgHeight.toFixed(precision)}mm"`);
        svgParts.push(`  viewBox="${viewBoxMinX.toFixed(precision)} ${viewBoxMinY.toFixed(precision)} ${svgWidth.toFixed(precision)} ${svgHeight.toFixed(precision)}"`);
        svgParts.push('  style="background-color: white">');
        
        // Add metadata
        svgParts.push('  <title>PCB Layout</title>');
        svgParts.push(`  <desc>PCB CAM Export ${new Date().toLocaleDateString()}</desc>`);
        
        // Define styles
        svgParts.push('  <defs>');
        svgParts.push('    <style type="text/css">');
        svgParts.push('      .isolation { fill: #ff8844; stroke: none; }');
        svgParts.push('      .clear { fill: #44ff88; stroke: none; }');
        svgParts.push('      .drill { fill: none; stroke: #4488ff; stroke-width: 0.2; }');
        svgParts.push('      .cutout { fill: none; stroke: #ff00ff; stroke-width: 0.1; }');
        svgParts.push('      .trace { fill: none; stroke: #ff8844; stroke-linecap: round; stroke-linejoin: round; }');
        svgParts.push('      .region { fill: #ff8844; stroke: none; }');
        svgParts.push('      .pad { fill: #ff8844; stroke: none; }');
        svgParts.push('    </style>');
        svgParts.push('  </defs>');
        
        // Create main group with Y-axis flip transformation
        svgParts.push('  <g transform="scale(1,-1)">');
        
        // Process layers and combine similar paths
        this.layers.forEach((layer, layerName) => {
            if (!layer.visible || !layer.primitives || layer.primitives.length === 0) return;
            
            const layerClass = this.getLayerClass(layer.type);
            svgParts.push(`    <g id="${this.sanitizeId(layerName)}" class="${layerClass}">`);
            
            // Combine similar paths for optimization
            const combinedPaths = this.combineSimilarPaths(layer.primitives, precision);
            
            combinedPaths.forEach(pathData => {
                svgParts.push('      ' + pathData);
            });
            
            svgParts.push('    </g>');
        });
        
        // Close main group and SVG
        svgParts.push('  </g>');
        svgParts.push('</svg>');
        
        const svgString = svgParts.join('\n');
        
        // Download the file
        this.downloadSVG(svgString);
        
        console.log(`SVG export complete (${(svgString.length / 1024).toFixed(1)} KB)`);
        return svgString;
    }
    
    // Helper: Combine similar paths for optimization
    combineSimilarPaths(primitives, precision) {
        const pathsByStyle = new Map();
        
        primitives.forEach(primitive => {
            const style = this.getStyleKey(primitive);
            
            if (!pathsByStyle.has(style)) {
                pathsByStyle.set(style, []);
            }
            
            pathsByStyle.get(style).push(primitive);
        });
        
        const combinedPaths = [];
        
        pathsByStyle.forEach((prims, styleKey) => {
            const style = JSON.parse(styleKey);
            
            // Combine all paths with same style into one element
            let pathData = '';
            
            prims.forEach(primitive => {
                const data = this.primitiveToPathData(primitive, precision);
                if (data) {
                    pathData += (pathData ? ' ' : '') + data;
                }
            });
            
            if (pathData) {
                const attrs = [];
                attrs.push(`d="${pathData}"`);
                
                if (style.fill) {
                    attrs.push(`fill="${style.fill}"`);
                } else {
                    attrs.push('fill="none"');
                }
                
                if (style.stroke) {
                    attrs.push(`stroke="${style.stroke}"`);
                    attrs.push(`stroke-width="${style.strokeWidth || 0.1}"`);
                    if (!style.closed) {
                        attrs.push('stroke-linecap="round"');
                        attrs.push('stroke-linejoin="round"');
                    }
                } else {
                    attrs.push('stroke="none"');
                }
                
                if (style.fillRule) {
                    attrs.push(`fill-rule="${style.fillRule}"`);
                }
                
                combinedPaths.push(`<path ${attrs.join(' ')} />`);
            }
        });
        
        return combinedPaths;
    }
    
    // Helper: Get style key for grouping
    getStyleKey(primitive) {
        const props = primitive.properties || {};
        const colors = this.colors[this.options.theme];
        
        const style = {
            fill: null,
            stroke: null,
            strokeWidth: null,
            fillRule: null,
            closed: primitive.closed
        };
        
        if (props.isRegion || (props.fill && !props.stroke)) {
            style.fill = this.getColorForProperty(props);
            if (props.hasHoles || props.isCompound) {
                style.fillRule = 'evenodd';
            }
        } else if (props.isTrace || props.isBranchSegment || (props.stroke && !props.fill)) {
            style.stroke = this.getColorForProperty(props);
            style.strokeWidth = props.strokeWidth || 0.1;
        } else if (props.isDrillHole) {
            style.stroke = colors.drill;
            style.strokeWidth = 0.2;
        } else if (props.isFlash || props.isPad) {
            style.fill = this.getColorForProperty(props);
        } else {
            // Default based on primitive type
            if (primitive.type === 'circle' || primitive.type === 'rectangle' || primitive.type === 'obround') {
                style.fill = this.getColorForProperty(props);
            } else if (primitive.type === 'path') {
                if (primitive.closed && props.fill !== false) {
                    style.fill = this.getColorForProperty(props);
                } else {
                    style.stroke = this.getColorForProperty(props);
                    style.strokeWidth = props.strokeWidth || 0.1;
                }
            }
        }
        
        return JSON.stringify(style);
    }
    
    // Helper: Convert primitive to path data only
    primitiveToPathData(primitive, precision) {
        const props = primitive.properties || {};
        
        switch (primitive.type) {
            case 'path':
                return this.pathToPathData(primitive, precision);
                
            case 'circle':
                return this.circleToPathData(primitive, precision);
                
            case 'rectangle':
                return this.rectangleToPathData(primitive, precision);
                
            case 'obround':
                return this.obroundToPathData(primitive, precision);
                
            default:
                return null;
        }
    }
    
    // Helper: Convert path to SVG path data
    pathToPathData(primitive, precision) {
        if (!primitive.points || primitive.points.length < 2) return null;
        
        let pathData = '';
        
        // Handle compound paths with holes
        if (primitive.properties?.isCompound && primitive.properties?.hasHoles) {
            let currentPath = [];
            let isFirstSegment = true;
            
            primitive.points.forEach(point => {
                if (point === null) {
                    if (currentPath.length > 0) {
                        if (isFirstSegment) {
                            pathData += this.pointsToPathData(currentPath, primitive.closed, precision);
                            isFirstSegment = false;
                        } else {
                            pathData += ' ' + this.pointsToPathData(currentPath, true, precision);
                        }
                        currentPath = [];
                    }
                } else {
                    currentPath.push(point);
                }
            });
            
            if (currentPath.length > 0) {
                if (isFirstSegment) {
                    pathData += this.pointsToPathData(currentPath, primitive.closed, precision);
                } else {
                    pathData += ' ' + this.pointsToPathData(currentPath, true, precision);
                }
            }
        } else {
            pathData = this.pointsToPathData(primitive.points, primitive.closed, precision);
        }
        
        return pathData;
    }
    
    // Helper: Convert circle to path data
    circleToPathData(primitive, precision) {
        const cx = primitive.center.x;
        const cy = primitive.center.y;
        const r = primitive.radius;
        
        // Use two arc commands for a complete circle
        return `M${(cx - r).toFixed(precision)},${cy.toFixed(precision)} ` +
               `A${r.toFixed(precision)},${r.toFixed(precision)} 0 0,1 ${(cx + r).toFixed(precision)},${cy.toFixed(precision)} ` +
               `A${r.toFixed(precision)},${r.toFixed(precision)} 0 0,1 ${(cx - r).toFixed(precision)},${cy.toFixed(precision)}`;
    }
    
    // Helper: Convert rectangle to path data
    rectangleToPathData(primitive, precision) {
        const x = primitive.position.x;
        const y = primitive.position.y;
        const w = primitive.width;
        const h = primitive.height;
        
        return `M${x.toFixed(precision)},${y.toFixed(precision)} ` +
               `h${w.toFixed(precision)} v${h.toFixed(precision)} h${(-w).toFixed(precision)} Z`;
    }
    
    // Helper: Convert obround to path data
    obroundToPathData(primitive, precision) {
        const x = primitive.position.x;
        const y = primitive.position.y;
        const w = primitive.width;
        const h = primitive.height;
        const r = Math.min(w, h) / 2;
        
        if (w > h) {
            // Horizontal obround
            return `M${(x + r).toFixed(precision)},${y.toFixed(precision)} ` +
                   `L${(x + w - r).toFixed(precision)},${y.toFixed(precision)} ` +
                   `A${r.toFixed(precision)},${r.toFixed(precision)} 0 0,1 ${(x + w - r).toFixed(precision)},${(y + h).toFixed(precision)} ` +
                   `L${(x + r).toFixed(precision)},${(y + h).toFixed(precision)} ` +
                   `A${r.toFixed(precision)},${r.toFixed(precision)} 0 0,1 ${(x + r).toFixed(precision)},${y.toFixed(precision)} Z`;
        } else {
            // Vertical obround
            return `M${x.toFixed(precision)},${(y + r).toFixed(precision)} ` +
                   `L${x.toFixed(precision)},${(y + h - r).toFixed(precision)} ` +
                   `A${r.toFixed(precision)},${r.toFixed(precision)} 0 0,1 ${(x + w).toFixed(precision)},${(y + h - r).toFixed(precision)} ` +
                   `L${(x + w).toFixed(precision)},${(y + r).toFixed(precision)} ` +
                   `A${r.toFixed(precision)},${r.toFixed(precision)} 0 0,1 ${x.toFixed(precision)},${(y + r).toFixed(precision)} Z`;
        }
    }
    
    // Helper: Get layer class for SVG
    getLayerClass(layerType) {
        switch (layerType) {
            case 'isolation': return 'isolation';
            case 'clear': return 'clear';
            case 'drill': return 'drill';
            case 'cutout': return 'cutout';
            default: return 'copper';
        }
    }
    
    // Helper: Sanitize ID for SVG
    sanitizeId(str) {
        return str.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
    }
    
    // Helper: Group primitives for SVG rendering
    groupPrimitivesForSVG(primitives) {
        const groups = {
            regions: [],
            traces: [],
            pads: [],
            drills: [],
            cutouts: []
        };
        
        primitives.forEach(primitive => {
            const props = primitive.properties || {};
            
            if (props.isDrillHole || primitive.type === 'drill') {
                groups.drills.push(primitive);
            } else if (props.isCutout) {
                groups.cutouts.push(primitive);
            } else if (props.isRegion || (props.fill && !props.stroke)) {
                groups.regions.push(primitive);
            } else if (props.isTrace || props.isBranchSegment || (props.stroke && !props.fill)) {
                groups.traces.push(primitive);
            } else if (props.isFlash || props.isPad) {
                groups.pads.push(primitive);
            } else {
                // Default based on primitive type
                if (primitive.type === 'circle' || primitive.type === 'rectangle') {
                    groups.pads.push(primitive);
                } else if (primitive.type === 'path') {
                    if (primitive.closed && props.fill !== false) {
                        groups.regions.push(primitive);
                    } else {
                        groups.traces.push(primitive);
                    }
                }
            }
        });
        
        return groups;
    }
    
    // Helper: Convert primitive to SVG element
    primitiveToSVGElement(primitive, precision = 3) {
        const props = primitive.properties || {};
        
        switch (primitive.type) {
            case 'path':
                return this.pathToSVGElement(primitive, props, precision);
                
            case 'circle':
                return this.circleToSVGElement(primitive, props, precision);
                
            case 'rectangle':
                return this.rectangleToSVGElement(primitive, props, precision);
                
            case 'obround':
                return this.obroundToSVGElement(primitive, props, precision);
                
            default:
                return null;
        }
    }
    
    // Helper: Convert path primitive to SVG
    pathToSVGElement(primitive, props, precision) {
        if (!primitive.points || primitive.points.length < 2) return null;
        
        let pathData = '';
        
        // Handle compound paths with holes
        if (props.isCompound && props.hasHoles) {
            let currentPath = [];
            let isFirstSegment = true;
            
            primitive.points.forEach((point, index) => {
                if (point === null) {
                    // End of current segment
                    if (currentPath.length > 0) {
                        if (isFirstSegment) {
                            pathData += this.pointsToPathData(currentPath, primitive.closed, precision);
                            isFirstSegment = false;
                        } else {
                            // Hole - add with space separator
                            pathData += ' ' + this.pointsToPathData(currentPath, true, precision);
                        }
                        currentPath = [];
                    }
                } else {
                    currentPath.push(point);
                }
            });
            
            // Handle last segment
            if (currentPath.length > 0) {
                if (isFirstSegment) {
                    pathData += this.pointsToPathData(currentPath, primitive.closed, precision);
                } else {
                    pathData += ' ' + this.pointsToPathData(currentPath, true, precision);
                }
            }
        } else {
            // Simple path
            pathData = this.pointsToPathData(primitive.points, primitive.closed, precision);
        }
        
        if (!pathData) return null;
        
        // Build attributes
        const attrs = [`d="${pathData}"`];
        
        // Fill and stroke
        if (props.fill === false || props.isTrace) {
            attrs.push('fill="none"');
            const strokeColor = this.getColorForProperty(props);
            const strokeWidth = props.strokeWidth || 0.1;
            attrs.push(`stroke="${strokeColor}"`);
            attrs.push(`stroke-width="${strokeWidth.toFixed(precision)}"`);
            
            if (!primitive.closed) {
                attrs.push('stroke-linecap="round"');
                attrs.push('stroke-linejoin="round"');
            }
        } else {
            const fillColor = this.getColorForProperty(props);
            attrs.push(`fill="${fillColor}"`);
            attrs.push('stroke="none"');
            
            if (props.hasHoles || props.isCompound) {
                attrs.push('fill-rule="evenodd"');
            }
        }
        
        return `<path ${attrs.join(' ')} />`;
    }
    
    // Helper: Convert points to SVG path data
    pointsToPathData(points, closed, precision) {
        if (!points || points.length < 2) return '';
        
        let data = `M${points[0].x.toFixed(precision)},${points[0].y.toFixed(precision)}`;
        
        for (let i = 1; i < points.length; i++) {
            data += ` L${points[i].x.toFixed(precision)},${points[i].y.toFixed(precision)}`;
        }
        
        if (closed) {
            data += ' Z';
        }
        
        return data;
    }
    
    // Helper: Convert circle to SVG element
    circleToSVGElement(primitive, props, precision) {
        const cx = primitive.center.x.toFixed(precision);
        const cy = primitive.center.y.toFixed(precision);
        const r = primitive.radius.toFixed(precision);
        
        const attrs = [`cx="${cx}"`, `cy="${cy}"`, `r="${r}"`];
        
        if (props.isDrillHole) {
            attrs.push('fill="none"');
            attrs.push('stroke="#4488ff"');
            attrs.push('stroke-width="0.2"');
        } else {
            const fillColor = this.getColorForProperty(props);
            attrs.push(`fill="${fillColor}"`);
            attrs.push('stroke="none"');
        }
        
        return `<circle ${attrs.join(' ')} />`;
    }
    
    // Helper: Convert rectangle to SVG element
    rectangleToSVGElement(primitive, props, precision) {
        const x = primitive.position.x.toFixed(precision);
        const y = primitive.position.y.toFixed(precision);
        const width = primitive.width.toFixed(precision);
        const height = primitive.height.toFixed(precision);
        
        const attrs = [`x="${x}"`, `y="${y}"`, `width="${width}"`, `height="${height}"`];
        
        const fillColor = this.getColorForProperty(props);
        attrs.push(`fill="${fillColor}"`);
        attrs.push('stroke="none"');
        
        return `<rect ${attrs.join(' ')} />`;
    }
    
    // Helper: Convert obround to SVG path
    obroundToSVGElement(primitive, props, precision) {
        const x = primitive.position.x;
        const y = primitive.position.y;
        const w = primitive.width;
        const h = primitive.height;
        const r = Math.min(w, h) / 2;
        
        let pathData = '';
        
        if (w > h) {
            // Horizontal obround
            pathData = `M${(x + r).toFixed(precision)},${y.toFixed(precision)}`;
            pathData += ` L${(x + w - r).toFixed(precision)},${y.toFixed(precision)}`;
            pathData += ` A${r.toFixed(precision)},${r.toFixed(precision)} 0 0,1 ${(x + w - r).toFixed(precision)},${(y + h).toFixed(precision)}`;
            pathData += ` L${(x + r).toFixed(precision)},${(y + h).toFixed(precision)}`;
            pathData += ` A${r.toFixed(precision)},${r.toFixed(precision)} 0 0,1 ${(x + r).toFixed(precision)},${y.toFixed(precision)}`;
        } else {
            // Vertical obround
            pathData = `M${x.toFixed(precision)},${(y + r).toFixed(precision)}`;
            pathData += ` L${x.toFixed(precision)},${(y + h - r).toFixed(precision)}`;
            pathData += ` A${r.toFixed(precision)},${r.toFixed(precision)} 0 0,1 ${(x + w).toFixed(precision)},${(y + h - r).toFixed(precision)}`;
            pathData += ` L${(x + w).toFixed(precision)},${(y + r).toFixed(precision)}`;
            pathData += ` A${r.toFixed(precision)},${r.toFixed(precision)} 0 0,1 ${x.toFixed(precision)},${(y + r).toFixed(precision)}`;
        }
        
        pathData += ' Z';
        
        const fillColor = this.getColorForProperty(props);
        return `<path d="${pathData}" fill="${fillColor}" stroke="none" />`;
    }
    
    // Helper: Get color based on properties
    getColorForProperty(props) {
        const colors = this.colors[this.options.theme];
        
        if (props.isDrillHole) return colors.drill;
        if (props.isCutout) return colors.cutout;
        if (props.operationType) {
            switch (props.operationType) {
                case 'isolation': return colors.isolation;
                case 'clear': return colors.clear;
                case 'drill': return colors.drill;
                case 'cutout': return colors.cutout;
            }
        }
        
        // Default to copper color
        return colors.copper;
    }
    
    // Helper: Download SVG file
    downloadSVG(svgString) {
        const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        
        link.href = url;
        link.download = `pcb-layout-${Date.now()}.svg`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        // Clean up
        setTimeout(() => URL.revokeObjectURL(url), 100);
    }
    
    // [... keeping all other methods unchanged ...]
    
    renderLayerDirect(layer) {
        const colors = this.colors[this.options.theme];
        
        // Use the layer's specified color or default to fused color
        const layerColor = layer.color || colors.fused;
        
        layer.primitives.forEach((primitive, index) => {
            this.renderStats.primitives++;
            this.renderStats.renderedPrimitives++;
            
            let fillColor = layerColor;
            let strokeColor = layerColor;
            
            if (this.options.blackAndWhite) {
                const bwColor = this.options.theme === 'dark' ? '#ffffff' : '#000000';
                fillColor = bwColor;
                strokeColor = bwColor;
            }
            
            // Render primitive directly
            this.renderPrimitive(primitive, fillColor, strokeColor);
        });
    }
    
    renderLayer(layer) {
        const colors = this.colors[this.options.theme];
        
        // Determine layer color
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
        
        layer.primitives.forEach((primitive, index) => {
            this.renderStats.primitives++;
            
            // Check if primitive should be filtered
            if (primitive.properties?.operationType && primitive.properties.operationType !== layer.type) {
                this.renderStats.skippedPrimitives++;
                return;
            }
            
            // Special handling for cutout layers
            if (layer.type === 'cutout') {
                if (!this.options.showCutouts) {
                    this.renderStats.skippedPrimitives++;
                    return;
                }
                
                this.renderStats.renderedPrimitives++;
                
                let fillColor = 'transparent';
                let strokeColor = layerColor;
                
                this.ctx.save();
                this.ctx.fillStyle = fillColor;
                this.ctx.strokeStyle = strokeColor;
                
                this.ctx.lineWidth = this.options.showWireframe ? 
                    this.getWireframeStrokeWidth() : 
                    this.getWireframeStrokeWidth();
                
                if (primitive.type === 'path' && primitive.points) {
                    this.ctx.beginPath();
                    primitive.points.forEach((point, i) => {
                        if (i === 0) {
                            this.ctx.moveTo(point.x, point.y);
                        } else {
                            this.ctx.lineTo(point.x, point.y);
                        }
                    });
                    if (primitive.closed) {
                        this.ctx.closePath();
                    }
                    this.ctx.stroke();
                } else {
                    this.renderPrimitive(primitive, fillColor, strokeColor);
                }
                
                this.ctx.restore();
                return;
            }
            
            // Regular geometry type filtering
            if (!this.shouldRenderPrimitive(primitive, layer.type)) {
                this.renderStats.skippedPrimitives++;
                return;
            }
            
            this.renderStats.renderedPrimitives++;
            
            let fillColor = layerColor;
            let strokeColor = layerColor;
            
            if (primitive.properties?.isNonConductor) {
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
    
    shouldRenderPrimitive(primitive, layerType) {
        // Always render fused primitives
        if (primitive.properties?.isFused) {
            return true;
        }
        
        // Drill holes
        if (primitive.properties?.isDrillHole || layerType === 'drill') {
            return this.options.showDrills;
        }
        
        // Traces (including branch segments)
        if (primitive.properties?.isTrace || primitive.properties?.isBranchSegment) {
            return this.options.showTraces;
        }
        
        // Pads/Flashes
        if (primitive.properties?.isFlash || 
            primitive.properties?.isBranchJunction ||
            (primitive.type === 'circle' && !primitive.properties?.isTrace) || 
            (primitive.type === 'rectangle' && !primitive.properties?.isTrace) || 
            primitive.type === 'obround') {
            return this.options.showPads;
        }
        
        // Regions (filled polygons)
        if (primitive.properties?.isRegion || 
            (primitive.type === 'path' && primitive.closed && primitive.properties?.fill)) {
            return this.options.showRegions;
        }
        
        // Open paths (traces)
        if (primitive.type === 'path' && !primitive.closed) {
            return this.options.showTraces;
        }
        
        return true;
    }
    
    renderPrimitive(primitive, fillColor, strokeColor) {
        this.ctx.save();
        
        this.ctx.fillStyle = fillColor;
        this.ctx.strokeStyle = strokeColor;
        
        if (this.options.showWireframe) {
            // WIREFRAME MODE: Show all geometry as simple paths
            this.ctx.lineWidth = this.getWireframeStrokeWidth();
            this.renderPrimitiveWireframe(primitive);
        } else {
            // NORMAL MODE: Render with proper fill/stroke
            this.renderPrimitiveNormal(primitive, fillColor, strokeColor);
        }
        
        this.ctx.restore();
    }
    
    renderPrimitiveNormal(primitive, fillColor, strokeColor) {
        const props = primitive.properties || {};
        
        switch (primitive.type) {
            case 'path':
                // Handle compound paths with holes (like text)
                if (props.isCompound && props.hasHoles) {
                    this.ctx.fillStyle = fillColor;
                    this.ctx.beginPath();
                    
                    let isNewSegment = true;
                    primitive.points.forEach(point => {
                        if (point === null) {
                            // Path break - next point starts a new subpath (hole)
                            isNewSegment = true;
                        } else {
                            if (isNewSegment) {
                                this.ctx.moveTo(point.x, point.y);
                                isNewSegment = false;
                            } else {
                                this.ctx.lineTo(point.x, point.y);
                            }
                        }
                    });
                    
                    // Use evenodd fill rule for proper hole rendering
                    this.ctx.fill('evenodd');
                }
                // FIXED: Explicit region handling - regions are ALWAYS fill-only
                else if (props.isRegion) {
                    // Region: Always fill, never stroke
                    this.ctx.fillStyle = fillColor;
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
                    // Use appropriate fill rule
                    if (props.fillRule === 'evenodd') {
                        this.ctx.fill('evenodd');
                    } else {
                        this.ctx.fill();
                    }
                } 
                // FIXED: More specific trace detection
                else if (props.isTrace || props.isBranchSegment || props.isConnectedPath || 
                        (props.stroke && props.strokeWidth && !props.fill)) {
                    // Trace: Always stroke, never fill
                    this.ctx.strokeStyle = strokeColor;
                    this.ctx.lineWidth = props.strokeWidth || 0.1;
                    this.ctx.lineCap = 'round';
                    this.ctx.lineJoin = 'round';
                    
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
                    this.ctx.stroke();
                } 
                // Default path handling based on properties
                else if (props.fill !== false) {
                    // Default to fill for closed paths
                    this.ctx.fillStyle = fillColor;
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
                    this.ctx.fill();
                }
                break;
                
            case 'circle':
                this.ctx.beginPath();
                this.ctx.arc(primitive.center.x, primitive.center.y, primitive.radius, 0, 2 * Math.PI);
                
                // Circles are typically pads or drill holes - always fill
                if (props.isDrillHole || props.isBranchJunction || props.isFlash || props.fill !== false) {
                    this.ctx.fill();
                }
                // Only stroke if explicitly requested and not a drill hole
                if (props.stroke && !props.isDrillHole) {
                    this.ctx.lineWidth = props.strokeWidth || 0.1;
                    this.ctx.stroke();
                }
                break;
                
            case 'rectangle':
                if (props.fill !== false) {
                    this.ctx.fillRect(primitive.position.x, primitive.position.y, primitive.width, primitive.height);
                }
                if (props.stroke) {
                    this.ctx.lineWidth = props.strokeWidth || 0.1;
                    this.ctx.strokeRect(primitive.position.x, primitive.position.y, primitive.width, primitive.height);
                }
                break;
                
            case 'obround':
                this.renderObroundNormal(primitive, props.fill !== false, props.stroke === true, props.strokeWidth || 0.1);
                break;
                
            case 'arc':
                this.ctx.lineWidth = props.strokeWidth || 0.1;
                this.renderArcNormal(primitive);
                break;
        }
    }
    
    getWireframeStrokeWidth() {
        const baseThickness = 0.08;
        const scaleFactor = 1.0 / this.viewScale;
        const minThickness = 0.02;
        const maxThickness = 0.2;
        
        return Math.max(minThickness, Math.min(maxThickness, baseThickness * scaleFactor));
    }
    
    renderPrimitiveWireframe(primitive) {
        switch (primitive.type) {
            case 'path':
                if (primitive.properties?.isTrace || primitive.properties?.isBranchSegment) {
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
                    
                    this.ctx.stroke();
                } else {
                    this.renderPathWireframe(primitive);
                }
                break;
                
            case 'circle':
                this.ctx.beginPath();
                this.ctx.arc(primitive.center.x, primitive.center.y, primitive.radius, 0, 2 * Math.PI);
                this.ctx.stroke();
                break;
                
            case 'rectangle':
                this.ctx.strokeRect(primitive.position.x, primitive.position.y, primitive.width, primitive.height);
                break;
                
            case 'obround':
                this.renderObroundWireframe(primitive);
                break;
                
            case 'arc':
                this.renderArcWireframe(primitive);
                break;
        }
    }
    
    renderPathWireframe(primitive) {
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
        
        this.ctx.stroke();
    }
    
    renderObroundWireframe(primitive) {
        const x = primitive.position.x;
        const y = primitive.position.y;
        const w = primitive.width;
        const h = primitive.height;
        const r = Math.min(w, h) / 2;
        
        this.ctx.beginPath();
        
        if (w > h) {
            // Horizontal obround
            this.ctx.moveTo(x + r, y);
            this.ctx.lineTo(x + w - r, y);
            this.ctx.arc(x + w - r, y + r, r, -Math.PI / 2, Math.PI / 2);
            this.ctx.lineTo(x + r, y + h);
            this.ctx.arc(x + r, y + r, r, Math.PI / 2, -Math.PI / 2);
        } else {
            // Vertical obround
            this.ctx.moveTo(x + w, y + r);
            this.ctx.lineTo(x + w, y + h - r);
            this.ctx.arc(x + r, y + h - r, r, 0, Math.PI);
            this.ctx.lineTo(x, y + r);
            this.ctx.arc(x + r, y + r, r, Math.PI, 0);
        }
        
        this.ctx.closePath();
        this.ctx.stroke();
    }
    
    renderObroundNormal(primitive, shouldFill, shouldStroke, strokeWidth) {
        const x = primitive.position.x;
        const y = primitive.position.y;
        const w = primitive.width;
        const h = primitive.height;
        const r = Math.min(w, h) / 2;
        
        this.ctx.beginPath();
        
        if (w > h) {
            // Horizontal obround
            this.ctx.moveTo(x + r, y);
            this.ctx.lineTo(x + w - r, y);
            this.ctx.arc(x + w - r, y + r, r, -Math.PI / 2, Math.PI / 2);
            this.ctx.lineTo(x + r, y + h);
            this.ctx.arc(x + r, y + r, r, Math.PI / 2, -Math.PI / 2);
        } else {
            // Vertical obround
            this.ctx.moveTo(x + w, y + r);
            this.ctx.lineTo(x + w, y + h - r);
            this.ctx.arc(x + r, y + h - r, r, 0, Math.PI);
            this.ctx.lineTo(x, y + r);
            this.ctx.arc(x + r, y + r, r, Math.PI, 0);
        }
        
        this.ctx.closePath();
        
        if (shouldFill) {
            this.ctx.fill();
        }
        if (shouldStroke) {
            this.ctx.lineWidth = strokeWidth;
            this.ctx.stroke();
        }
    }
    
    renderArcWireframe(primitive) {
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
        this.ctx.stroke();
    }
    
    renderArcNormal(primitive) {
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
        this.ctx.stroke();
    }
    
    renderGrid() {
        const colors = this.colors[this.options.theme];
        const gridSpacing = this.calculateGridSpacing();
        const viewBounds = this.getViewBounds();
        
        this.ctx.strokeStyle = colors.grid;
        this.ctx.lineWidth = 0.1 / this.viewScale;
        this.ctx.setLineDash([]);
        
        this.ctx.beginPath();
        
        // Grid aligned to current origin position
        const originX = this.originPosition.x;
        const originY = this.originPosition.y;
        
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
    
    renderOrigin() {
        const colors = this.colors[this.options.theme];
        
        const markerSize = 10 / this.viewScale;
        const circleSize = 3 / this.viewScale;
        const strokeWidth = 3 / this.viewScale;
        
        const originX = this.originPosition.x;
        const originY = this.originPosition.y;
        
        // Draw outline for better visibility
        this.ctx.strokeStyle = colors.originOutline;
        this.ctx.lineWidth = strokeWidth + (1 / this.viewScale);
        
        this.ctx.beginPath();
        this.ctx.moveTo(originX - markerSize, originY);
        this.ctx.lineTo(originX + markerSize, originY);
        this.ctx.moveTo(originX, originY - markerSize);
        this.ctx.lineTo(originX, originY + markerSize);
        this.ctx.stroke();
        
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
        
        this.ctx.beginPath();
        this.ctx.arc(originX, originY, circleSize, 0, 2 * Math.PI);
        this.ctx.stroke();
        
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
        
        const originX = this.originPosition.x;
        const originY = this.originPosition.y;
        
        const startXWorld = Math.floor((viewBounds.minX - originX) / majorStep) * majorStep + originX;
        const endXWorld = Math.ceil((viewBounds.maxX - originX) / majorStep) * majorStep + originX;
        
        for (let xWorld = startXWorld; xWorld <= endXWorld; xWorld += majorStep) {
            const xCanvas = this.worldToCanvasX(xWorld);
            if (xCanvas >= rulerSize && xCanvas <= this.canvas.width) {
                this.ctx.moveTo(xCanvas, rulerSize);
                this.ctx.lineTo(xCanvas, rulerSize - tickLength);
                
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
        
        const startYWorld = Math.floor((viewBounds.minY - originY) / majorStep) * majorStep + originY;
        const endYWorld = Math.ceil((viewBounds.maxY - originY) / majorStep) * majorStep + originY;
        
        for (let yWorld = startYWorld; yWorld <= endYWorld; yWorld += majorStep) {
            const yCanvas = this.worldToCanvasY(yWorld);
            if (yCanvas >= 0 && yCanvas <= this.canvas.height) {
                this.ctx.moveTo(rulerSize, yCanvas);
                this.ctx.lineTo(rulerSize - tickLength, yCanvas);
                
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
    
    // Coordinate system interface
    setOriginPosition(x, y) {
        this.originPosition.x = x;
        this.originPosition.y = y;
        this.render();
    }
    
    setRotation(angle, center) {
        this.currentRotation = angle;
        if (center) {
            this.rotationCenter.x = center.x;
            this.rotationCenter.y = center.y;
        }
        this.render();
    }
    
    getOriginPosition() {
        return { ...this.originPosition };
    }
    
    getBackgroundColor() {
        return this.colors[this.options.theme].background;
    }
    
    resizeCanvas() {
        const parent = this.canvas.parentElement;
        if (parent) {
            const rect = parent.getBoundingClientRect();
            this.canvas.width = rect.width;
            this.canvas.height = rect.height;
            this.render();
        }
    }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = CanvasRenderer;
} else {
    window.CanvasRenderer = CanvasRenderer;
}