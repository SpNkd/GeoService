# DXF layouts and paper presentation

Current interaction contract: Paper-owned geometry is readonly; canonical MODEL geometry through a supported active MODEL viewport remains editable. Source viewport definitions and VP Freeze metadata remain readonly. See [CAD selection / Properties](SELECTION_PROPERTIES.md).

A document has one MODEL entity/vertex registry. Optional `dxfLayouts` is imported presentation metadata: source ID, source layout name (or an explicitly identified Paper Space block fallback), owner handle, paper settings when available, paper primitives and **multiple viewports**. MODEL geometry is never copied into layouts. Paper primitives reuse the same shared block definitions, use the importer drawing factor and are not counted as top-level MODEL entities.

The raw adapter reads OBJECTS/LAYOUT subclasses, TABLES/BLOCK_RECORD ownership and VIEWPORT records in ENTITIES and BLOCKS. It does not rely on dxf-parser exposing layouts. Group 331 handles resolve against source LAYER handles; freeze lists belong to a viewport, not to the whole layout. Plot settings are read only from the AcDbPlotSettings subclass, avoiding colliding group codes. VIEWPORT ID 1 describes the paper presentation; IDs greater than 1 are MODEL windows.

`DXF: Model / <source layouts>` appears only when imported metadata exists. A viewport chooser changes the active viewport used by layer badges and local query scope. Every supported viewport is rendered, independently clipped, with its own scale, center, twist and frozen layers. Clicking a viewport makes it active and selects the MODEL owner under the cursor. Paper primitives render in a separate Canvas pass; frame/text/blocks use existing safe DXF support. No large SVG tree is materialized.

For a +Z orthographic viewport, paper coordinates are `paperCenter + scale * (R(twist) * (MODEL - target) - centerDCS)`. The MODEL camera center is `target + R(-twist) * centerDCS`. Screen coordinates invert Y; the nested paper pass rotates by negative twist. The inner Canvas covers the viewport diagonal so rotated corners are not clipped prematurely. This matches the [ezdxf viewport transformation implementation](https://github.com/mozman/ezdxf/blob/master/src/ezdxf/entities/viewport.py). Group definitions: [Autodesk LAYOUT](https://help.autodesk.com/cloudhelp/2025/ENU/AutoCAD-DXF/files/GUID-433D25BF-655D-4697-834E-C666EDFD956D.htm) and [Autodesk VIEWPORT](https://help.autodesk.com/cloudhelp/2016/ENU/AutoCAD-DXF/files/GUID-2602B0FB-02E4-4B9A-B03C-B1D904753D34.htm).

Effective visibility is global layer visibility AND no VP Freeze AND temporary layer isolation. VP Freeze is readonly and explicitly labelled, distinct from the global eye. A presentation-only freeze set also applies to inherited block/attribute/proxy primitives, so inheritance cannot bypass a frozen source layer. Canonical layers are never mutated by layout/viewport switching. These actions, panel filters, selection and isolation add no history or dirty state. Bulk global visibility follows the existing document policy and commits one Undo batch, including locked layers (lock restricts geometry edits).

A layout enters Plan presentation and disables the projection selector with an explanation. Returning to Model restores the previous Plan/Axon mode and independent camera. Layout camera pan/zoom is local UI state. MODEL transforms remain MODEL transforms; free drag/editing paper/viewports/VP Freeze is out of scope.

Current-view local search and AI query `scope: current_view` intersect canonical owner results with active viewport effective visibility and conservative bounds against its rotated clip rectangle. Bounds intersection is deliberately conservative; it does not prove every pixel is visible. Without explicit scope, the established whole-document query semantics remain. The LLM receives only request text and returns concept/scope. No IDs, document/layout catalog or matching results are transmitted. Preview becomes stale when its scoped layout, viewport or isolation changes.

Unsupported perspective, tilted view direction, disabled viewports and nonrectangular clipping remain represented with an explicit reason rather than fabricated MODEL content. Fonts, HATCH patterns, CAD text alignment, line types, plot offsets/rotation, plot styles and exact print paper fidelity retain existing limitations. No viewport editing, plot/PDF engine, DWG, CTB/STB or external XREF loading is included.

## Reference file audit

| Paper block | Owner | MODEL viewports | Paper primitives |
| --- | --- | ---: | ---: |
| *Paper_Space111 | 8E105 | 2 | 8 |
| *Paper_Space266 | 84D84 | 2 | 73 |
| *Paper_Space268 | 8E549 | 3 | 24 |
| *Paper_Space289 | 8E92A | 6 | 116 |
| *Paper_Space | 8DFC4 | 2 | 96 |

Total: 20 raw VIEWPORT entities, including five ID-1 paper views and 15 MODEL windows. MODEL windows use a 7.85256216136421° twist. Source scale ratios are approximately 0.5, 1 and 2. Freeze combinations include `_ГП__ПОР`, `__П`, `_ГП__БЛАГ`, `_ГП__СПИС`, `__СТРУКТУРКИ`, `__НЕПЕЧ`; several viewports have no frozen layers. Source owner handles, full centers/scales and per-viewport arrays are preserved in the import metadata. No actual human-readable layout name is invented.

`src/tests/fixtures/dxf/layouts.dxf` is a deterministic named A/B fixture: BUILDING/ROAD/UTILITY MODEL entities; A has two viewports with UTILITY and ROAD frozen respectively, B freezes ROAD. It verifies paper ownership, multiple viewports and unchanged global visibility. Tests also verify nonzero twist, scope staleness and Plan/Axon camera restoration.

Wheel, middle-button pan, toolbar zoom and Fit operate on the paper camera; the MODEL camera is preserved. Both layer and owner isolation in Layout obey canonical global visibility. Offscreen viewport passes are omitted, and visible inner Canvas dimensions are capped to the screen diagonal with a shifted MODEL camera, so strong paper zoom does not allocate a sheet-sized bitmap. The wheel listener is explicitly nonpassive. Safe paper support excludes standalone ATTRIB roots/SEQEND; complete CAD attribute/plot fidelity remains outside this subset.

## Verification of this slice (2026-10-06)

## Transform, style and navigation polish

DXF Views is a hierarchical navigation control: one Model Space; five source Paper Space containers on the reference; their 15 MODEL viewport windows are not separate Model Spaces. Expanding a container shows its windows with scale, MODEL center and VP Freeze count. Selecting Paper Space fits the whole presentation and renders all supported windows. Selecting a window activates and fits its paper rectangle; layer badges use that active window. Fit Paper Space, Fit Viewport and Back to Model change only view state. Missing names are explained as «Имя исходного листа отсутствует в DXF». Editing paper, viewport geometry or VP Freeze remains unsupported.

## Scoped selection and canonical MODEL editing

Current sheet selection now means the union of globally visible, non-isolated Paper primitives and canonical MODEL owners intersecting any supported window on that sheet, deduplicated by owner ID. Current view means the sheet union in PAPER mode and the active window in MODEL viewport editing mode. Explicit Model All includes hidden objects; Model Visible respects global visibility/isolation. Viewport Visible additionally respects VP Freeze and actual projected primitive intersection with the source clip. Broad owner bounds alone do not accept a candidate. Deep primitive paths stay evidence, never copied ordinary entities.

Double-clicking a supported window or choosing «Редактировать модель» activates the normal MODEL Canvas inside its sheet clip. Screen → paper camera → viewport local coordinates → inverse source twist/scale → MODEL center is shared with rendering. Normal/deep/multi/window/crossing selection, snapping, drawing, measurement, Move/Rotate, Symbols, Connectors and inspector commands operate on the same canonical MODEL. Source VP Freeze is a presentation mask, independent from global layer visibility. Frozen/outside geometry cannot be hit or snapped through the active clip. Committing or undoing a MODEL edit updates every relevant viewport and Model Space. Temporary drag previews prioritize the active window; inactive windows retain committed geometry until commit. No Paper or viewport geometry/VP Freeze editing is introduced.

For sheet camera motion, complete viewport presentations below 2048 CSS pixels per side are reused at a stable resolution, then refreshed after 120 ms idle. Document/layer/freeze/source setting changes invalidate their presentation immediately. At extreme zoom the renderer switches to a bounded screen surface with vector redraw and source clipping. Cached definition draw lists/Path2D are shared across passes. Sheet camera motion does not change MODEL geometry or resize backing buffers on each wheel/pan event. This replaces the previous per-event inner-diagonal buffer behavior described in the earlier verification section.

Active MODEL viewport Space-pan and anchored zoom use temporary MODEL center/scale, preserve the sheet camera and imported viewport metadata, and reset on exit. Scope/hit/snap follow the temporary window. Fit resets this temporary navigation; source twist and VP Freeze remain intact. Controlled floating palettes register with the shared popup boundary; keyboard-focused controls keep native keyboard interaction.
