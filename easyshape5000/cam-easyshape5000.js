/*!
 * @file        easyshape5000/cam-easyshape5000.js
 * @description EasyShape5000 application controller - owns scene, history,
 *              mutations, modals, and keyboard. Delegates all UI to EasyShapeUI.
 * @author      Eltryus - Ricardo Marques
 * @copyright   2025-2026 Eltryus - Ricardo Marques
 * @see         {@link https://github.com/RicardoJCMarques/EasyTrace5000}
 *
 * SPDX-FileCopyrightText: 2025-2026 Eltryus - Ricardo Marques
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

(function() {
    'use strict';

    const C = window.CAMConfig.constants;
    const D = window.CAMConfig.defaults;
    const debugState = D.debug;
    const decimals = D.gcode.decimals.coordinates;

    class EasyShapeController extends CamController {
        constructor() {
            super();
            this.scene = null;
            this.selection = null;
            this.sceneInteraction = null;
            this.history = null;

            this.defaultStock = {
                width: 600, height: 400, thickness: 18,
                material: 'plywood', zeroReference: 'bottom-left'
            };
        }

        // ════════════════════════════════════════════════════════════════
        // Template Hooks
        // ════════════════════════════════════════════════════════════════

        getAppLabel() { return 'EasyShape5000 Workspace'; }

        getProfileConfig() {
            return { embeddedVar: 'EMBEDDED_PROFILE_SHAPE', fetchPath: '../ui/profile-shape.json' };
        }

        onCoreReady() {
            this.scene = this.core.scene;
            this.selection = this.scene.selection;
            this.sceneInteraction = this.core.sceneInteraction;
            this.history = new CommandManager(this);
        }

        onProfileLoaded(profileData) {
            if (profileData.machineDefaults?.stock) {
                this.core.stock = { ...profileData.machineDefaults.stock };
            }
        }

        createUI() {
            return new EasyShapeUI(this);
        }

        registerHandlers() {
            // Parsers
            if (typeof SVGParser !== 'undefined') this.core.registerParser('.svg', new SVGParser());
            if (typeof STLParser !== 'undefined') this.core.registerParser('.stl', new STLParser());

            // Handlers
            if (typeof ShapeProfileHandler !== 'undefined')
                this.core.registerHandler('profile', new ShapeProfileHandler(this.core));
            if (typeof ShapePocketHandler !== 'undefined')
                this.core.registerHandler('pocket', new ShapePocketHandler(this.core));
            if (typeof ShapeDrillHandler !== 'undefined')
                this.core.registerHandler('drill', new ShapeDrillHandler(this.core));
            if (typeof ShapeVCarveHandler !== 'undefined')
                this.core.registerHandler('vcarve', new ShapeVCarveHandler(this.core));
            if (typeof ShapeReliefHandler !== 'undefined')
                this.core.registerHandler('relief', new ShapeReliefHandler(this.core));
            if (typeof ShapeEngraveHandler !== 'undefined')
                this.core.registerHandler('engrave', new ShapeEngraveHandler(this.core));
            if (typeof ShapePatternHandler !== 'undefined')
                this.core.registerHandler('pattern', new ShapePatternHandler(this.core));
        }

        registerAppShortcuts() {
            const sm = this.shortcutManager;

            sm.register('ctrl+z', () => this.history.undo(), { mod: true });
            sm.register('ctrl+shift+z', () => this.history.redo(), { mod: true });
            sm.register('ctrl+y', () => this.history.redo(), { mod: true });
            sm.register('ctrl+g', () => this.groupSelection(), { mod: true });
            sm.register('ctrl+shift+g', () => this.ungroupSelection(), { mod: true });
            sm.register('ctrl+a', () => {
                const ids = [];
                for (const child of this.scene.root.children) ids.push(child.id);
                if (ids.length > 0) this.selection.replace(ids);
            }, { mod: true });
            sm.register('Delete', () => {
                if (this.selection.size() > 0) this.deleteShapes(Array.from(this.selection.toSet()));
            });
            sm.register('Backspace', () => {
                if (this.selection.size() > 0) this.deleteShapes(Array.from(this.selection.toSet()));
            });
            sm.register('i', () => document.getElementById('toolbar-import-svg')?.click());
        }

        onBindEvents() {
            this.selection.addChangeListener(() => this.ui.onSelectionChanged());
            this.history.addListener(() => this.ui.updateHistoryButtons());
            this.setupToolbar();
            this.setupViewportBarDismiss();
            this.setupWelcomeFlow();
            this.setupStockAndMachine();
        }

        onFinalize() {
            this.ui.renderAll();
            this.modalManager.showModal('welcome');
            window.easyshape = this;
        }

        handleEscapeKey(e) {
            if (this.selection.size() > 0) this.selection.clear();
        }

        // ════════════════════════════════════════════════════════════════
        // File Import
        // ════════════════════════════════════════════════════════════════

        async loadExample(exampleId) {
            const examples = this.getExamples();
            const example = examples[exampleId];
            if (!example) { this.ui.setStatus(`Example not found: ${exampleId}`, 'error'); return; }
            this.ui.setStatus(`Loading example: ${example.name}...`, 'info');
            try {
                const file = example.files?.svg || Object.values(example.files)[0];
                const resp = await fetch(file);
                if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                const content = await resp.text();
                await this.importSVG(new File([content], file.split('/').pop(), { type: 'image/svg+xml' }));
            } catch (e) { this.ui.setStatus(`Failed to load example: ${e.message}`, 'error'); }
        }

        /**
         * Standardized entry point for ModalManager/Quickstart.
         * Routes files to the correct importer based on extension.
         */
        async processFile(file, type) {
            if (!file) return;
            const ext = file.name.toLowerCase().split('.').pop();

            if (ext === 'svg') {
                await this.importSVG(file);
            } else if (ext === 'stl') {
                await this.importSTL(file);
            } else {
                this.ui.setStatus(`Unsupported file type: .${ext}`, 'warning');
            }
        }

        /**
         * Imports an STL as a relief operation. Bypasses ParserPlotter
         * and the scene shape tree entirely - the mesh attaches to the
         * operation, and ShapeReliefHandler slices it into a heightmap
         * on demand (so resolution params always take effect).
         */
        // Not Wired yet
        async importSTL(file) {
            if (!file) return;
            this.ui.setStatus(`Loading ${file.name}…`);

            let buffer;
            try { buffer = await this.readFileAsArrayBuffer(file); }
            catch (err) { this.ui.setStatus(`Failed to read ${file.name}: ${err.message}`, 'error'); return; }

            const parser = new STLParser();
            const parseResult = parser.parse(buffer);
            if (!parseResult.success) {
                this.ui.setStatus(`STL parse error: ${(parseResult.errors?.join('; ')) || 'Unknown'}`, 'error');
                return;
            }

            const operation = this.core.createOperation('relief', { label: file.name });
            operation.reliefMesh = {
                triangles: parseResult.triangles,
                triangleCount: parseResult.triangleCount,
                bounds3D: parseResult.bounds3D
            };
            operation.bounds = parseResult.bounds;
            operation.primitives = [];
            operation.processed = true;
            if (parseResult.warnings?.length) operation.warnings = [...parseResult.warnings];

            this.core.updateStatistics();
            this.ui.renderAll?.();
            this.ui.setStatus(
                `Loaded ${file.name}: ${parseResult.triangleCount} triangles, ` +
                `${(parseResult.bounds3D.maxZ - parseResult.bounds3D.minZ).toFixed(2)}mm model height`,
                'success'
            );
            return operation;
        }

        async importSVG(file) {
            if (!file) return;
            this.ui.setStatus(`Loading ${file.name}…`);
            let content;
            try { content = await this.readFileAsText(file); }
            catch (err) { this.ui.setStatus(`Failed to read ${file.name}: ${err.message}`, 'error'); return; }

            const parser = new SVGParser();
            const parseResult = parser.parse(content);
            if (!parseResult.success) { this.ui.setStatus(`Parse error: ${(parseResult.errors?.join('; ')) || 'Unknown'}`, 'error'); return; }
            if (parseResult.warnings?.length > 0) for (const w of parseResult.warnings) console.warn(`[EasyShape] SVG warning:`, w);

            const plotter = new ParserPlotter({ markStrokes: true });
            const plotResult = plotter.plot(parseResult);
            if (!plotResult.success) { this.ui.setStatus(`Plotter error: ${plotResult.error}`, 'error'); return; }

            const beforeCount = this.scene.shapeCount();
            this.scene.addShapesFromPlot(plotResult.primitives, file.name);
            const added = this.scene.shapeCount() - beforeCount;

            this.history.clear();
            this.scene.recomputeBoardBoundsFromShapes();
            this.ui.renderAll();
            this.ui.zoomFit();
            this.ui.setStatus(`Imported ${file.name}: ${added} shape(s)`, 'success');
        }

        // ════════════════════════════════════════════════════════════════
        // Mutation Helpers
        // ════════════════════════════════════════════════════════════════

        canMutateNode(node) {
            if (!node) return false;
            if (node.isLocked) return false;
            if (this.hasLockedDescendant(node)) return false;
            return true;
        }

        hasLockedDescendant(node) {
            if (!node?.children) return false;
            for (const c of node.children) { if (c.locked || this.hasLockedDescendant(c)) return true; }
            return false;
        }

        hasLockedAncestor(node) {
            if (!node) return false;
            let n = node.parent;
            while (n && n.kind !== 'root') { if (n.locked) return true; n = n.parent; }
            return false;
        }

        getActionableIds() {
            return this.selection.toArray().filter(id => this.canMutateNode(this.scene.findNode(id)));
        }

        getTopLevelActionableIds(idList = null) {
            const selected = new Set(idList || this.selection.toArray());
            const topLevel = new Set();
            for (const id of selected) {
                const node = this.scene.findNode(id);
                if (!this.canMutateNode(node)) continue;
                let isChild = false, p = node.parent;
                while (p && p.kind !== 'root') { if (selected.has(p.id)) { isChild = true; break; } p = p.parent; }
                if (!isChild) topLevel.add(id);
            }
            return Array.from(topLevel);
        }

        // ════════════════════════════════════════════════════════════════
        // Shape Mutations
        // ════════════════════════════════════════════════════════════════

        deleteShapes(ids) {
            const snapshots = [];
            for (const id of ids) {
                const node = this.scene.findNode(id);
                if (!node) continue;
                const parent = node.parent || null;
                snapshots.push({ shape: node, parentId: parent?.id || null, indexInParent: parent ? parent.children.indexOf(node) : -1 });
            }
            if (snapshots.length === 0) return;
            this.history.executeAndRecord(new DeleteShapesCommand(snapshots));
        }

        toggleNodeFlag(nodeId, flag) {
            const inSelection = this.selection.has(nodeId);
            let targetIds = inSelection ? Array.from(this.selection.toSet()) : [nodeId];

            if (flag === 'locked') {
                const blocked = [];
                targetIds = targetIds.filter(id => {
                    const n = this.scene.findNode(id);
                    if (!n) return false;
                    if (this.hasLockedAncestor(n)) { blocked.push(id); return false; }
                    return true;
                });
                if (targetIds.length === 0) { this.ui.setStatus('Locked by parent - unlock the parent first', 'warning'); return; }
                if (blocked.length > 0) this.ui.setStatus(`${blocked.length} item(s) skipped (locked by parent)`, 'info');
            }

            let anyFalse = false;
            for (const id of targetIds) { const n = this.scene.findNode(id); if (n && !n[flag]) { anyFalse = true; break; } }
            const newValue = anyFalse;
            const entries = [];
            for (const id of targetIds) { const n = this.scene.findNode(id); if (!n || n[flag] === newValue) continue; entries.push({ nodeId: id, prevValue: n[flag], newValue }); }
            if (entries.length === 0) return;
            if (flag === 'locked' && newValue === true) this.selection.batch(() => { entries.forEach(e => this.selection.remove(e.nodeId)); });
            this.history.executeAndRecord(new SetNodeFlagCommand(entries, flag));
        }

        assignOperationToSelection(opType) {
            const entries = [];
            for (const id of this.getActionableIds()) {
                const shape = this.scene.findShape(id);
                if (!shape) continue;
                entries.push({ shapeId: id, prevOp: shape.operation ? { ...shape.operation } : null, newOp: { type: opType, params: {} } });
            }
            if (entries.length === 0) return;
            this.history.executeAndRecord(new AssignOperationCommand(entries, 'Assign'));
            this.ui.setStatus(`Assigned ${opType} to ${entries.length} shape(s)`);
        }

        clearOperationFromSelection() {
            const entries = [];
            for (const id of this.getActionableIds()) {
                const shape = this.scene.findShape(id);
                if (!shape?.operation) continue;
                entries.push({ shapeId: id, prevOp: { ...shape.operation }, newOp: null });
            }
            if (entries.length === 0) return;
            this.history.executeAndRecord(new AssignOperationCommand(entries, 'Remove'));
            this.ui.setStatus(`Removed operation from ${entries.length} shape(s)`);
        }

        groupSelection() {
            const ids = this.getActionableIds();
            if (ids.length < 2) { this.ui.setStatus('Select 2 or more items to group'); return; }
            const snapshots = ids.map(id => { const n = this.scene.findNode(id); return { nodeId: id, parentId: n.parent?.id || null, indexInParent: n.parent ? n.parent.children.indexOf(n) : -1 }; });
            const firstNode = this.scene.findNode(ids[0]);
            this.history.executeAndRecord(new GroupCommand(snapshots, firstNode.parent?.id || null, firstNode.parent ? firstNode.parent.children.indexOf(firstNode) : 0, `g_${Date.now()}`));
            this.ui.setStatus(`Grouped ${ids.length} items`, 'success');
        }

        ungroupSelection() {
            const groupIds = this.getActionableIds().filter(id => { const n = this.scene.findNode(id); return n?.kind === 'group' && n.children?.length > 0; });
            if (groupIds.length === 0) { this.ui.setStatus('No groups in selection to ungroup'); return; }
            const commands = [];
            for (const gid of groupIds) {
                const group = this.scene.findNode(gid);
                if (!group) continue;
                const gSnap = { nodeId: group.id, label: group.label, parentId: group.parent?.id || null, indexInParent: group.parent ? group.parent.children.indexOf(group) : -1,
                    transform: { x: group.transform.x, y: group.transform.y, rotation: group.transform.rotation, scaleX: group.transform.scaleX, scaleY: group.transform.scaleY, rotationCenter: group.transform.rotationCenter ? { x: group.transform.rotationCenter.x, y: group.transform.rotationCenter.y } : null } };
                const cSnaps = group.children.map((c, i) => ({ nodeId: c.id, indexInParent: i, newParentId: group.parent?.id || null, newIndex: gSnap.indexInParent + i,
                    transform: { x: c.transform.x, y: c.transform.y, rotation: c.transform.rotation, scaleX: c.transform.scaleX, scaleY: c.transform.scaleY, rotationCenter: c.transform.rotationCenter ? { x: c.transform.rotationCenter.x, y: c.transform.rotationCenter.y } : null } }));
                commands.push(new UngroupCommand(gSnap, cSnaps));
            }
            if (commands.length === 1) this.history.executeAndRecord(commands[0]);
            else if (commands.length > 1) this.history.executeAndRecord(new CompositeCommand(commands, `Ungroup ${commands.length} groups`));
            this.ui.setStatus(`Ungrouped ${commands.length} group(s)`, 'success');
        }

        alignSelectionTo(target) {
            const bounds = this.scene.getSelectionWorldBounds();
            const stock = this.core.stock;
            if (!bounds || !stock || !this.scene) return;
            const cx = (bounds.minX + bounds.maxX) / 2, cy = (bounds.minY + bounds.maxY) / 2;
            let dx = 0, dy = 0;
            const ox = this.scene.transform.origin.x, oy = this.scene.transform.origin.y;
            if (target === 'center') { dx = ox - cx; dy = oy - cy; }
            else if (target === 'bottom-left') { dx = ox - bounds.minX; dy = oy - bounds.minY; }
            if (dx === 0 && dy === 0) return;
            const ids = this.getTopLevelActionableIds();
            if (ids.length === 0) return;
            this.history.executeAndRecord(new TranslateCommand(ids, dx, dy));
        }

        // REVIEW - Currently unused, Could be worth having a single reset button in the tool bar menu that reloads the original geometry without any transforms? For users that want to reset without tracking files to add again?
        resetShapeTransform() {
            const ids = this.getTopLevelActionableIds();
            if (ids.length === 0) return;
            const commands = [];
            for (const id of ids) {
                const node = this.scene.findNode(id);
                if (!node) continue;
                const t = node.transform;
                if (t.x === 0 && t.y === 0 && t.rotation === 0 && t.scaleX === 1 && t.scaleY === 1) continue;
                commands.push(new SetShapeTransformCommand(id, { ...t, rotationCenter: t.rotationCenter ?? null }, { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, rotationCenter: null }));
            }
            if (commands.length === 1) this.history.executeAndRecord(commands[0]);
            else if (commands.length > 1) this.history.executeAndRecord(new CompositeCommand(commands, 'Reset Transforms'));
        }

        // ════════════════════════════════════════════════════════════════
        // Bucket Lifecycle
        // ════════════════════════════════════════════════════════════════

        /**
         * Removes stale shape refs from every bucket. If a bucket loses
         * all its refs (every source shape was deleted), the bucket and
         * its backing core operation are removed entirely.
         */
        cleanupOrphanedBuckets() {
            if (!this.ui.opsPanel) return;

            const bucketsToRemove = [];

            for (const bucket of this.ui.opsPanel.getAllBuckets()) {
                const prevCount = bucket.shapeRefs.length;

                bucket.shapeRefs = bucket.shapeRefs.filter(ref =>
                    this.scene.findShape(ref) !== null
                );

                if (bucket.shapeRefs.length === 0) {
                    bucketsToRemove.push(bucket.id);
                } else if (bucket.shapeRefs.length !== prevCount) {
                    // Some refs died but bucket survives — update count + invalidate
                    bucket.isInvalidated = true;
                    bucket.invalidatedReason = 'Source shape(s) deleted. Regenerate offsets.';
                    this.ui.opsPanel.updateBucketDOM(bucket, this.core);
                }
            }

            for (const bucketId of bucketsToRemove) {
                this.ui.opsPanel.removeBucket(bucketId, this.core);
            }
        }

        afterMutation() {
            this.cleanupOrphanedBuckets();

            if (this.ui.opsPanel) {
                // Collect IDs of shapes that could have changed
                const changedShapeIds = new Set();
                for (const id of this.selection.toArray()) {
                    const node = this.scene.findNode(id);
                    if (!node) continue;
                    if (node.kind === 'shape') changedShapeIds.add(id);
                    else for (const sid of this.scene.collectShapeIds(node)) changedShapeIds.add(sid);
                }

                for (const bucket of this.ui.opsPanel.getAllBuckets()) {
                    if (!bucket.hasOffsets && !bucket.hasPreview) continue;
                    // Only invalidate if this bucket references an affected shape
                    const isAffected = bucket.shapeRefs.some(ref => changedShapeIds.has(ref));
                    if (!isAffected) continue;
                    bucket.isInvalidated = true;
                    bucket.invalidatedReason = 'Source geometry changed. Regenerate offsets.';
                    this.ui.opsPanel.updateBucketDOM(bucket, this.core);
                }
            }
            this.ui.renderAll();
            this.ui.syncTransformFromSelection();
        }

        afterFlagMutation() {
            this.cleanupOrphanedBuckets();
            this.ui.navScenePanel.updateFlagStates();
            this.ui.navScenePanel.syncTreeToolbar(this.selection, this.scene);
            this.ui.syncTransformFromSelection();
            this.ui.rebuildLayers();
            const container = document.getElementById('operation-form-container');
            const anchorId = this.selection.anchor();
            const anchor = anchorId ? this.scene.findShape(anchorId) : null;
            if (container && anchor?.operation && this.ui.shapeOperationPanel) {
                this.ui.shapeOperationPanel.showOperationProperties(
                    container, anchor, this.ui.shapeOperationPanel.getCurrentStage()
                );
            }
        }

        ensureBucketParamsLoaded(operations) {
            for (const op of operations) {
                const bucket = this.ui.opsPanel?.getBucket(op.id);
                if (bucket) {
                    this.parameterManager.loadFromOperation({
                        id: op.id, type: op.type, settings: bucket.settings || {}
                    });
                }
            }
        }

        clearScene() {
            // Remove all buckets before clearing the scene so core
            // operations are cleaned up in the correct order.
            if (this.ui.opsPanel) {
                for (const bucket of this.ui.opsPanel.getAllBuckets()) {
                    this.ui.opsPanel.removeBucket(bucket.id, this.core);
                }
            }
            this.scene.clear();
            this.history.clear();
        }

        // ════════════════════════════════════════════════════════════════
        // Toolbar
        // ════════════════════════════════════════════════════════════════

        setupToolbar() {
            this.setupToolbarDropdown('quick-actions-btn', 'quick-actions-menu');

            const importBtn = document.getElementById('toolbar-import-svg');
            const hidden = document.getElementById('file-input-hidden');
            if (importBtn && hidden) {
                importBtn.addEventListener('click', () => {
                    hidden.accept = '.svg';
                    hidden.onchange = async (e) => { const f = e.target.files?.[0]; if (f) await this.importSVG(f); hidden.value = ''; };
                    hidden.click();
                    this.closeDropdown();
                });
            }

            const canvas = document.getElementById('preview-canvas');
            const container = canvas?.parentElement;
            if (container) {
                container.addEventListener('dragover', e => { if (!document.querySelector('.modal.active')) e.preventDefault(); });
                container.addEventListener('drop', e => {
                    if (document.querySelector('.modal.active')) return;
                    e.preventDefault();
                    const f = e.dataTransfer.files?.[0];
                    if (f && /\.svg$/i.test(f.name)) this.importSVG(f);
                    else if (f) this.ui.setStatus(`Unsupported file: ${f.name}`, 'warning');
                });
            }

            document.getElementById('btn-clear-all')?.addEventListener('click', () => {
                if (this.scene.shapeCount() === 0) return;
                this.clearScene(); this.ui.renderAll(); this.ui.setStatus('Scene cleared');
            });

            document.getElementById('toolbar-export-canvas')?.addEventListener('click', async () => {
                if (!this.ui.canvasExporter) {
                    this.ui.setStatus('Canvas exporter not available', 'error');
                    return;
                }
                try {
                    this.ui.canvasExporter.exportCanvasSVG();
                    this.ui.setStatus('Canvas exported successfully', 'success');
                } catch (error) {
                    console.error('Canvas export error:', error);
                    this.ui.setStatus('Canvas export failed: ' + error.message, 'error');
                }
                this.closeDropdown();
            });

            this.setupSharedToolbarButtons();

            document.getElementById('btn-undo')?.addEventListener('click', () => { const lbl = this.history.getTopUndoLabel(); if (this.history.undo()) this.ui.setStatus(`Undo: ${lbl}`); });
            document.getElementById('btn-redo')?.addEventListener('click', () => { if (this.history.redo()) this.ui.setStatus(`Redo: ${this.history.getTopUndoLabel() || ''}`); });
            document.getElementById('toolbar-export-gcode')?.addEventListener('click', () => {
                const readyOps = this.core.operations.filter(op => this.core.isExportReady(op));
                if (readyOps.length === 0) { this.ui.setStatus('No operations ready for export. Generate previews first.', 'warning'); return; }
                this.ensureBucketParamsLoaded(readyOps);
                this.modalManager.showModal('exportManager', { operations: readyOps });
                this.closeDropdown();
            });
        }

        // ════════════════════════════════════════════════════════════════
        // Modals
        // ════════════════════════════════════════════════════════════════

        setupWelcomeFlow() {
            document.querySelectorAll('[data-welcome-action]').forEach(card => {
                card.addEventListener('click', e => {
                    e.preventDefault();
                    this.modalManager.closeModal();
                    switch (card.dataset.welcomeAction) {
                        case 'start': this.modalManager.showModal('quickstart'); break;
                        case 'example': this.loadExample('mesa'); break;
                        case 'reopen': this.ui.setStatus('Project reopen not wired yet.'); break;
                    }
                });
            });

            ['sponsor-slot-1', 'sponsor-slot-2', 'sponsor-slot-3', 'sponsor-contact-cta'].forEach(id => {
                document.getElementById(id)?.addEventListener('click', (e) => { e.preventDefault(); this.modalManager.showModal('support'); });
            });

            const dropZone = document.getElementById('qs-drop-zone');
            const qsInput = document.getElementById('qs-file-input');
            if (dropZone && qsInput) {
                dropZone.addEventListener('click', () => qsInput.click());
                dropZone.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); qsInput.click(); } });
                ['dragover', 'dragenter'].forEach(ev => dropZone.addEventListener(ev, e => { e.preventDefault(); dropZone.classList.add('dragging'); }));
                ['dragleave', 'drop'].forEach(ev => dropZone.addEventListener(ev, e => { e.preventDefault(); dropZone.classList.remove('dragging'); }));
                dropZone.addEventListener('drop', e => { const f = e.dataTransfer.files?.[0]; if (f) { this.modalManager.closeModal(); this.importSVG(f); } });
                qsInput.addEventListener('change', e => { const f = e.target.files?.[0]; if (f) { this.modalManager.closeModal(); this.importSVG(f); } qsInput.value = ''; });
            }
        }

        setupStockAndMachine() {
            this.committedOrigin = this.scene
                ? { x: this.scene.transform.origin.x, y: this.scene.transform.origin.y }
                : { x: 0, y: 0 };
            const xInput = document.getElementById('stock-x-offset');
            const yInput = document.getElementById('stock-y-offset');

            if (xInput) xInput.value = (0).toFixed(decimals);
            if (yInput) yInput.value = (0).toFixed(decimals);

            if (this.scene) {
                this.scene.addTransformListener(() => {
                    if (!xInput || !yInput || !this.scene) return;
                    const o = this.scene.transform.origin;
                    xInput.value = (o.x - this.committedOrigin.x).toFixed(decimals);
                    yInput.value = (o.y - this.committedOrigin.y).toFixed(decimals);
                });
            }

            const updatePreview = () => {
                if (!this.scene) return;
                this.scene.setOrigin(
                    this.committedOrigin.x + (parseFloat(xInput?.value) || 0),
                    this.committedOrigin.y + (parseFloat(yInput?.value) || 0)
                );
                this.ui.renderer?.render();
            };

            xInput?.addEventListener('input', updatePreview);
            yInput?.addEventListener('input', updatePreview);

            document.getElementById('stock-center-btn')?.addEventListener('click', () => {
                if (!this.scene || !this.core.stock) return;
                const cx = this.core.stock.width / 2, cy = this.core.stock.height / 2;
                this.scene.setOrigin(cx, cy);
                this.ui.renderer?.render();
            });

            document.getElementById('stock-bottom-left-btn')?.addEventListener('click', () => {
                if (!this.scene) return;
                this.scene.setOrigin(0, 0);
                this.ui.renderer?.render();
            });

            const applyStock = () => {
                const w = parseFloat(document.getElementById('stock-width')?.value);
                const h = parseFloat(document.getElementById('stock-height')?.value);
                const t = parseFloat(document.getElementById('stock-thickness')?.value);
                if (!this.core.stock) this.core.stock = { ...this.defaultStock };
                if (Number.isFinite(w) && w > 0) this.core.stock.width = w;
                if (Number.isFinite(h) && h > 0) this.core.stock.height = h;
                if (Number.isFinite(t) && t > 0) this.core.stock.thickness = t;
                const mat = document.getElementById('stock-material')?.value;
                const zRef = document.getElementById('z-zero')?.value;
                if (mat) this.core.stock.material = mat;
                if (zRef) this.core.stock.zeroReference = zRef;
                if (this.scene) {
                    this.committedOrigin = { x: this.scene.transform.origin.x, y: this.scene.transform.origin.y };
                }
                if (xInput) xInput.value = (0).toFixed(decimals);
                if (yInput) yInput.value = (0).toFixed(decimals);
                this.ui.rebuildLayers(); this.ui.zoomFit();
                this.core.saveSettings();
                this.ui.setStatus('Stock settings and origin applied', 'success');
            };

            const resetStock = () => {
                this.core.stock = { ...this.defaultStock };
                this.core.saveSettings();
                const stockW = document.getElementById('stock-width');
                const stockH = document.getElementById('stock-height');
                const stockT = document.getElementById('stock-thickness');
                const stockM = document.getElementById('stock-material');
                const zEl = document.getElementById('z-zero');
                if (stockW) stockW.value = this.defaultStock.width;
                if (stockH) stockH.value = this.defaultStock.height;
                if (stockT) stockT.value = this.defaultStock.thickness;
                if (stockM) stockM.value = this.defaultStock.material;
                if (zEl) zEl.value = 'material';
                if (this.scene) this.scene.setOrigin(this.committedOrigin.x, this.committedOrigin.y);
                if (xInput) xInput.value = (0).toFixed(decimals);
                if (yInput) yInput.value = (0).toFixed(decimals);
                this.ui.rebuildLayers(); this.ui.zoomFit();
                this.ui.setStatus('Stock reset to defaults');
            };

            document.getElementById('apply-stock')?.addEventListener('click', applyStock);
            document.getElementById('reset-stock')?.addEventListener('click', resetStock);
        }
    }

    // ════════════════════════════════════════════════════════════════
    // Bootstrap
    // ════════════════════════════════════════════════════════════════

    let ctrl = null;

    async function startShapeApp() {
        if (ctrl) return ctrl;
        ctrl = new EasyShapeController();
        await ctrl.initialize();
        return ctrl;
    }

    window.startShapeApp = startShapeApp;

    // REVIEW - Anywhere else this should be? Is it being used yet? This seems like it should be shared?
    window.showShapeStats = function() { 
        if (ctrl) ctrl.logState(); 
        else console.error('Application not initialized'); 
    };
    window.enableShapeDebug = function() { 
        debugState.enabled = true; 
        console.log('Debug mode enabled'); 
    };
    window.disableShapeDebug = function() { 
        debugState.enabled = false; 
        console.log('Debug mode disabled'); 
    };
    window.getShapeReconstructionRegistry = function() {
        if (!ctrl.core.geometryProcessor) { 
            console.error('Geometry processor not initialized'); 
            return; 
        }
        // REVIEW - exportRegistry doesn't exist.
        const registry = ctrl.core.geometryProcessor.arcReconstructor?.exportRegistry?.();
        if (registry) { console.table(registry); }
        return registry;
    };
})();