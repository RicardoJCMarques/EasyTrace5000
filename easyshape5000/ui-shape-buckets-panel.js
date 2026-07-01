/*!
 * @file        easyshape5000/ui-shape-buckets-panel.js
 * @description Operation buckets panel - EasyShape5000 only.
 *              Manages the operation list below the scene tree.
 *              Each bucket represents one CAM operation with three
 *              stage nodes: Geometry, Offsets, Preview.
 *              Emits events - the controller decides what to execute.
 * @author      Eltryus - Ricardo Marques
 * @copyright   2025-2026 Eltryus - Ricardo Marques
 * @see         {@link https://github.com/RicardoJCMarques/EasyTrace5000}
 *
 * SPDX-FileCopyrightText: 2025-2026 Eltryus - Ricardo Marques
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

(function() {
    'use strict';

    // ═══════════════════════════════════════════════════════════════
    // Data Model
    // ═══════════════════════════════════════════════════════════════

    class OperationBucket {
        constructor(operationId, type, label, shapeRefs) {
            this.id = operationId;       // Same as the operation ID in core.operations[]
            this.type = type;
            this.label = label;
            this.shapeRefs = Array.isArray(shapeRefs) ? [...shapeRefs] : [shapeRefs];
            this.settings = {};
        }

        /**
         * Syncs primitives from scene current shapes into the operation in core.
         */
        syncPrimitives(core, scene) {
            const operation = core.getOperation(this.id);
            if (!operation) return;

            operation.primitives = [];
            operation.shapeKeyToNodeId = new Map();   // dense sourceId → scene node id (UI / debug / future reorder)
            let shapeKeySeq = 0;
            const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };

            for (const sid of this.shapeRefs) {
                const shape = scene.findShape(sid);
                if (!shape?.primitive) continue;

                // Transform primitive to world space so offsets render correctly
                const m = shape.getWorldMatrix();
                const transformed = GeometryUtils.transformPrimitive(shape.primitive, m);
                if (!transformed) continue;

                // Per-operation dense identity (1..N).
                const sourceId = ++shapeKeySeq;
                (transformed.properties ||= {}).sourceId = sourceId;
                operation.shapeKeyToNodeId.set(sourceId, sid);

                // Stamp non-arc points so the Z channel carries identity through Clipper booleans.
                // Only full circles don't have non-arc points.
                if (transformed.contours) {
                    for (const c of transformed.contours) {
                        if (!c.points) continue;
                        for (const pt of c.points) {
                            if (!pt.curveId || pt.curveId <= 0) pt.sourceId = sourceId;
                        }
                    }
                }

                operation.primitives.push(transformed);

                // Bounds from the already-transformed primitive
                const b = transformed.getBounds();
                if (b) {
                    if (b.minX < bounds.minX) bounds.minX = b.minX;
                    if (b.minY < bounds.minY) bounds.minY = b.minY;
                    if (b.maxX > bounds.maxX) bounds.maxX = b.maxX;
                    if (b.maxY > bounds.maxY) bounds.maxY = b.maxY;
                }
            }

            operation.bounds = isFinite(bounds.minX) ? bounds : { minX: 0, minY: 0, maxX: 0, maxY: 0 };
        }

        /**
         * Reads current state from the real operation in core.
         */
        getOperation(core) {
            return core.operations.find(op => op.id === this.id) || null;
        }

        get hasOffsets() {
            // Caller must pass core or this must be checked via getOperation
            // For DOM state checks, NavOperationsPanel passes core through
            return this.cachedHasOffsets || false;
        }

        get hasPreview() {
            return this.cachedHasPreview || false;
        }

        /**
         * Updates cached flags from the real operation. Called after generation.
         */
        syncStateFromOperation(core) {
            const op = this.getOperation(core);
            if (!op) return;
            this.cachedHasOffsets = op.offsets && op.offsets.length > 0;
            this.cachedHasPreview = op.preview?.ready === true;
            // Clear invalidation after successful generation
            if (this.cachedHasOffsets) {
                this.isInvalidated = false;
                this.invalidatedReason = null;
            }
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // Panel UI
    // ═══════════════════════════════════════════════════════════════

    class NavOperationsPanel extends EventEmitter {
        constructor() {
            // Event emitter
            super();

            this.container = null;
            this.buckets = new Map();
            this.selectedNode = null; // { bucketId, stage }
        }

        // Initialization
        init(containerId) {
            this.container = document.getElementById(containerId || 'operations-bucket-list');
            if (this.container) {
                this.container.addEventListener('keydown', (e) => this.handleKeydown(e));
            }
            this.updateEmptyState();
        }

        setSceneResolver(fn) {
            this._resolveScene = fn;
        }

        // Bucket CRUD
        /**
         * Creates a new operation bucket backed by a real operation in core.
         * @param {CamCore} core - The core instance
         * @param {Scene} scene - The scene instance
         * @param {string} type - Operation type
         * @param {string} label - Display label
         * @param {string[]} shapeRefs - Shape IDs from scene
         * @returns {string} The new bucket's ID (same as operation ID)
         */
        createBucket(core, scene, type, label, shapeRefs) {
            const operation = core.createOperation(type, { label });
            const bucket = new OperationBucket(operation.id, type, label, shapeRefs);
            bucket.syncPrimitives(core, scene);
            this.buckets.set(operation.id, bucket);
            this.renderBucket(bucket);
            this.updateEmptyState();
            return operation.id;
        }

        removeBucket(bucketId, core) {
            const bucket = this.buckets.get(bucketId);
            if (!bucket) return;

            const row = this.container.querySelector(`.bucket-row[data-bucket-id="${bucketId}"]`);
            if (row) row.remove();

            // Remove from core.operations[]
            // REVIEW - What is this doing exactly? Is it a connection to the core operation creation? The base operation could remain in the core?
            if (core) core.removeOperation(bucketId);

            this.buckets.delete(bucketId);

            if (this.selectedNode?.bucketId === bucketId) {
                this.selectedNode = null;
            }

            this.updateEmptyState();
            this.emit('bucketRemoved', { bucketId, bucket });
        }

        getBucket(bucketId) {
            return this.buckets.get(bucketId) || null;
        }

        /**
         * Returns all buckets that reference a given shape ID.
         */
        getBucketsForShape(shapeId) {
            const result = [];
            for (const bucket of this.buckets.values()) {
                if (bucket.shapeRefs.includes(shapeId)) result.push(bucket);
            }
            return result;
        }

        /**
         * Adds shape refs to an existing bucket. Invalidates if geometry was generated.
         */
        addShapesToBucket(bucketId, shapeIds, scene, core) {
            const bucket = this.buckets.get(bucketId);
            if (!bucket) return;

            for (const id of shapeIds) {
                const node = scene.findNode(id);
                if (!node) continue;
                if (node.kind === 'group') {
                    for (const sid of scene.collectShapeIds(node)) {
                        if (!bucket.shapeRefs.includes(sid)) bucket.shapeRefs.push(sid);
                    }
                } else if (node.kind === 'shape') {
                    if (!bucket.shapeRefs.includes(id)) bucket.shapeRefs.push(id);
                }
            }

            // Re-sync operation primitives with updated refs
            if (core) bucket.syncPrimitives(core, scene);

            if (bucket.hasOffsets) {
                bucket.isInvalidated = true;
                bucket.invalidatedReason = 'Source geometry changed. Regenerate offsets.';
            }

            this.updateBucketDOM(bucket);
        }

        removeShapeFromBucket(bucketId, shapeId) {
            const bucket = this.buckets.get(bucketId);
            if (!bucket) return;
            bucket.shapeRefs = bucket.shapeRefs.filter(id => id !== shapeId);

            if (bucket.hasOffsets) {
                bucket.isInvalidated = true;
                bucket.invalidatedReason = 'Source geometry changed. Regenerate offsets.';
            }

            this.updateBucketDOM(bucket);
        }

        // Generation State Updates

        /**
         * Called after handler.orchestrateGeneration succeeds.
         * Writes results into the bucket and updates the DOM.
         */
        updateBucketAfterGeneration(bucketId, core) {
            const bucket = this.buckets.get(bucketId);
            if (!bucket) return;
            bucket.syncStateFromOperation(core);
            this.updateBucketDOM(bucket);
        }

        /**
         * Clears a specific stage's generated geometry.
         * Parallel to EasyTrace's handleDeleteGeometry.
         */
        clearBucketStage(bucketId, stage, core) {
            const bucket = this.buckets.get(bucketId);
            if (!bucket || !core) return;

            const op = bucket.getOperation(core);
            if (!op) return;

            if (stage === 'preview') {
                op.preview = null;
                op.exportReady = false;
            } else if (stage === 'offsets') {
                op.offsets = [];
                op.exportReady = false;   // no offsets → not exportable, even if a stale preview remains 
                // REVIEW - just because offsets were deleted it technically doesn't mean the offsets are stale? Offssets can never be readed to a given bucket so the preview object is always updated.
            }

            bucket.syncStateFromOperation(core);
            this.updateBucketDOM(bucket, core);
            this.emit('stageCleared', { bucketId, stage });
        }

        // Selection
        selectStage(bucketId, stage) {
            // Clear all selection highlights
            this.container.querySelectorAll('.bucket-header.selected, .stage-node.selected')
                .forEach(el => el.classList.remove('selected'));

            this.selectedNode = { bucketId, stage };

            const row = this.container.querySelector(`.bucket-row[data-bucket-id="${bucketId}"]`);
            if (!row) return;

            if (stage === 'geometry') {
                row.querySelector('.bucket-header')?.classList.add('selected');
            } else {
                const stageNode = row.querySelector(`.stage-node[data-stage="${stage}"]`);
                if (stageNode) {
                    stageNode.classList.add('selected');
                } else {
                    // Stage doesn't exist in DOM (data was deleted) - fall back to header
                    row.querySelector('.bucket-header')?.classList.add('selected');
                    this.selectedNode.stage = 'geometry';
                }
            }

            this.emit('select', { bucketId, stage: this.selectedNode.stage });
        }

        getSelectedBucketId() {
            return this.selectedNode?.bucketId || null;
        }

        getSelectedStage() {
            return this.selectedNode?.stage || null;
        }

        // DOM Rendering
        buildStages(bucket, container, core) {
            container.innerHTML = '';
            const intrinsicStages = ['offsets', 'preview'];

            for (const stage of intrinsicStages) {
                const hasData = (stage === 'offsets' && bucket.hasOffsets) ||
                                (stage === 'preview' && bucket.hasPreview);
                if (!hasData) continue;

                const stageLabel = stage.charAt(0).toUpperCase() + stage.slice(1);

                const node = document.createElement('div');
                node.className = 'stage-node';
                node.dataset.stage = stage;
                node.setAttribute('tabindex', '-1');
                node.setAttribute('role', 'treeitem');

                const isInvalidated = stage === 'offsets' && core &&
                    bucket.getOperation(core)?.isInvalidated && bucket.hasOffsets;

                if (isInvalidated) node.classList.add('is-invalidated');

                node.innerHTML = `
                    <span class="stage-icon"><svg class="cam-icon" width="14" height="14"><use href="#icon-${stage}-stage"></use></svg></span>
                    <span class="stage-label">${stageLabel}</span>
                    <span class="stage-info"></span>
                    <button class="btn btn--icon btn--compact stage-delete" data-action="delete-stage" title="Delete ${stageLabel}">
                        <svg class="cam-icon" width="12" height="12"><use href="#icon-delete"></use></svg>
                    </button>
                `;

                node.addEventListener('click', (e) => {
                    if (e.target.closest('[data-action]')) {
                        e.stopPropagation();
                        this.emit('action', {
                            bucketId: bucket.id,
                            action: 'delete-stage',
                            stage: stage
                        });
                        return;
                    }
                    this.selectStage(bucket.id, stage);
                });

                container.appendChild(node);
            }
        }

        renderBucket(bucket) {
            const row = document.createElement('div');
            row.className = 'bucket-row';
            row.dataset.bucketId = bucket.id;
            row.dataset.op = bucket.type;
            row.setAttribute('role', 'treeitem');

            // Header
            const header = document.createElement('div');
            header.className = 'bucket-header';
            header.setAttribute('tabindex', '-1');

            header.innerHTML = `
                <span class="bucket-icon"><svg class="cam-icon" width="14" height="14"><use href="#icon-op-${bucket.type}"></use></svg></span>
                <span class="bucket-label"></span>
                <span class="bucket-info">${bucket.shapeRefs.length} shape(s)</span>
                <button class="btn btn--icon btn--compact bucket-delete" data-action="delete-bucket" title="Delete operation" aria-label="Delete operation">
                    <svg class="cam-icon" width="12" height="12"><use href="#icon-delete"></use></svg>
                </button>
            `;
            let displayLabel = bucket.label;
            if (bucket.shapeRefs.length === 1) {
                const shape = this._resolveScene?.()?.findShape(bucket.shapeRefs[0]);
                if (shape?.label && shape.label !== 'Shape') displayLabel = shape.label;
            }
            header.querySelector('.bucket-label').textContent = displayLabel;

            header.addEventListener('click', (e) => {
                if (e.target.closest('[data-action]')) {
                    e.stopPropagation();
                    const action = e.target.closest('[data-action]').dataset.action;
                    if (action === 'delete-bucket') {
                        this.emit('action', { bucketId: bucket.id, action: 'delete' });
                    }
                    return;
                }
                // Click header = select geometry stage
                this.selectStage(bucket.id, 'geometry');
            });

            row.appendChild(header);

            // Stage nodes
            const stages = document.createElement('div');
            stages.className = 'bucket-stages';

            this.buildStages(bucket, stages, null);

            row.appendChild(stages);

            // Insert before empty state
            const emptyState = document.getElementById('ops-empty-state');
            if (emptyState) {
                this.container.insertBefore(row, emptyState);
            } else {
                this.container.appendChild(row);
            }

            this.updateStageInfo(bucket, row, null);
        }

        updateBucketDOM(bucket, core) {
            const row = this.container.querySelector(`.bucket-row[data-bucket-id="${bucket.id}"]`);
            if (!row) return;

            row.querySelector('.bucket-label').textContent = bucket.label;
            const infoEl = row.querySelector('.bucket-info');
            if (infoEl) infoEl.textContent = `${bucket.shapeRefs.length} shape(s)`;

            const stages = row.querySelector('.bucket-stages');
            if (stages) {
                this.buildStages(bucket, stages, core);
            }

            this.updateStageInfo(bucket, row, core);
        }

        updateStageInfo(bucket, row, core) {
            // Offsets info
            const offInfo = row.querySelector('.stage-node[data-stage="offsets"] .stage-info');
            if (offInfo) {
                const op = core ? bucket.getOperation(core) : null;
                if (op?.offsets?.length > 0) {
                    const count = op.offsets.reduce((s, o) => s + (o.primitives?.length || 0), 0);
                    offInfo.textContent = `${count} path(s)`;
                } else {
                    offInfo.textContent = '';
                }
            }

            // Preview info
            const prvInfo = row.querySelector('.stage-node[data-stage="preview"] .stage-info');
            if (prvInfo) {
                prvInfo.textContent = bucket.hasPreview ? 'Ready' : '';
            }
        }

        updateEmptyState() {
            const isEmpty = this.buckets.size === 0;

            const emptyState = document.getElementById('ops-empty-state');
            if (emptyState) {
                emptyState.style.display = isEmpty ? '' : 'none';
            }

            if (this.container) {
                if (isEmpty) {
                    this.container.removeAttribute('role');
                    this.container.removeAttribute('aria-label');
                } else {
                    this.container.setAttribute('role', 'tree');
                    this.container.setAttribute('aria-label', 'Operations');
                }
            }
        }

        refreshPanel() {
            if (!this.container) return;
            this.container.querySelectorAll('.bucket-row').forEach(r => r.remove());
            for (const bucket of this.buckets.values()) {
                this.renderBucket(bucket);
            }
            this.updateEmptyState();
        }

        // Keyboard Navigation
        handleKeydown(e) {
            if (!this.container) return;
            const focused = document.activeElement;
            if (!this.container.contains(focused)) return;

            const rows = Array.from(this.container.querySelectorAll('.bucket-header, .stage-node:not(.is-gated)'));
            const idx = rows.indexOf(focused);
            if (idx === -1) return;

            switch (e.key) {
                case 'ArrowDown':
                    e.preventDefault();
                    if (rows[idx + 1]) { focused.setAttribute('tabindex', '-1'); rows[idx + 1].setAttribute('tabindex', '0'); rows[idx + 1].focus(); }
                    break;
                case 'ArrowUp':
                    e.preventDefault();
                    if (rows[idx - 1]) { focused.setAttribute('tabindex', '-1'); rows[idx - 1].setAttribute('tabindex', '0'); rows[idx - 1].focus(); }
                    break;
                case 'Enter': case ' ':
                    e.preventDefault();
                    focused.click();
                    break;
                case 'Delete': case 'Backspace':
                    e.preventDefault();
                    if (focused.classList.contains('bucket-header')) {
                        const bucketId = focused.closest('.bucket-row')?.dataset.bucketId;
                        if (bucketId) this.emit('action', { bucketId, action: 'delete' });
                    } else if (focused.classList.contains('stage-node')) {
                        const bucketId = focused.closest('.bucket-row')?.dataset.bucketId;
                        const stage = focused.dataset.stage;
                        if (bucketId && stage !== 'geometry') {
                            this.emit('action', { bucketId, action: 'delete-stage', stage });
                        }
                    }
                    break;
            }
        }

        // Queries
        getAllBuckets() { return Array.from(this.buckets.values()); }

        getExportReadyBuckets() {
            return this.getAllBuckets().filter(b => b.exportReady);
        }
    }

    window.NavOperationsPanel = NavOperationsPanel;
    window.OperationBucket = OperationBucket;
})();