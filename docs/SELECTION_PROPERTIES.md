# CAD selection and Properties

GeoDocument remains the canonical MODEL document. No DXF entity is exploded or copied into a viewport. All queries and table discovery remain browser-local.

## Ordinary click and Tab

Selection uses geometric narrow phase after immutable owner/primitive BVHs; DOM order and SVG event targets do not choose the CAD object. Existing visible edit grips remain explicit UI affordances. Thin imported strokes use the same screen-scaled pick tolerance as native geometry; their selection does not require a pixel-perfect click or Alt. The wider click band does not grant a body drag in unpainted gaps: dragging there starts a marquee, while a click still picks the nearby contour. Actual painted geometry and already selected objects retain body drag.

The normal deterministic order is:

1. Native annotations (text/label), then points, then other native geometric contours.
2. Imported/nested visible text and instance-owned ATTRIB.
3. Concrete painted block/imported leaves (Line/path/Arc/etc.), deeper leaf first.
4. Explicit canonical parent BlockInstance, then nested INSERT context.
5. Interior-only fills and source HATCH backgrounds (fallback after relevant strokes).

Normal hover highlights only the concrete leaf; normal click inspects it without exploding/copying a shared definition. Properties shows type/source/layer/path, MODEL coordinates and transformed length, and states shared-definition editing is unsupported. Cmd/Ctrl+click on a leaf selects its containing canonical owner; **Выбрать блок** is the visible equivalent. Only then is whole-instance movement/editing available. ATTRIB remains instance-owned and editable; native/nested ATTDEF is a template, not a pretend independent text entity. Alt keeps the legacy owner-first explicit depth stack. Tab/Shift+Tab cycle concrete leaves plus parent context; inspection never changes document/history.

Model, rotated Plan, Paper-owned primitives and active MODEL viewport use the same ownership distinction. Paper remains read-only. Leaf highlights compose camera rotation/twist with the block transform; parent selection clears leaf state. A forgiving click in an unpainted band still chooses a leaf, while drag there begins a marquee. Layer global visibility and VP Freeze remain independent and unchanged.

Layer locks prevent edits without changing geometric selection priority, so locked points remain selectable and inspectable at line endpoints.

Within a class prefer smaller world bounds area, then the canonical ID lexicographically. Zero-area lines use the ID tie-break. This order does not infer engineering importance or glyph outlines. Nested definition text continues to select its block normally; ordinary selection inspects only instance ATTRIB, never recursively expands definitions. ATTRIB is exposed only when the existing canonical attribute command can identify its source primitive.

Click retains a local transient candidate stack. With canvas focus, Tab/Shift+Tab advances/backtracks and wraps; an indicator shows position, CAD type and layer for 2.5 seconds. The stack is invalid after document/camera changes, tool/selection changes or Escape. Space, text entry, native keyboard control navigation and transient edits do not cycle. Escape follows the shared popup → interaction → editor order; it does not cancel several levels at once.

Alt/Option+click retains advanced geometric inspection of nested block elements. Shared definitions are readonly, while instance ATTRIB uses `update-block-attribute`. Choosing a block does not give permission to edit its shared definition.

Global visibility, isolation, source VP Freeze and geometric viewport clipping apply. Source freezing is independent of the global layer eye. Sheet selection resolves Paper IDs separately from canonical MODEL IDs, deduplicates MODEL candidates across overlapping windows, and uses the same ranking. A mixed selection containing Paper geometry cannot partially apply an entity edit.

## Highlight and focus

Hover uses a lighter, independent contour overlay. Selection continues to follow geometry/text rather than replacing complex blocks by giant boxes. Existing transform handles/bounds supplement the contour. Neither hover nor ordinary selection invalidates the bulk DXF draw-list/Path2D cache or redraws the base solely to change the highlight.

Pointer actions in nontext controls return focus to the canvas through the shared editor focus boundary. Keyboard-only select navigation retains native focus. Search, AI, numerical editing and contenteditable keep normal whitespace and native Undo. Canvas pointerdown focuses with `preventScroll`.

## Properties

The dock shows a CAD ownership breadcrumb, object name/type and collapsible General, Geometry, Block, Attributes and Style groups where meaningful. Source starts collapsed and contains canonical ID, DXF type/layer/handle, source document, definition identity and provenance path. Block shows transform and compact element/instance counts; it does not enumerate its definition geometry. Semantic summary construction can omit recursive text extraction for Properties while the semantic API retains its default text behavior.

Instance ATTRIB fields commit through the existing source-index/tag/handle command; they respect both instance and attribute layer locks. Legacy dictionary-only values without source attribute geometry are readonly. Native geometry keeps canonical coordinate/edit transactions. Large vertex tables show at most 64 rows, attributes at most 40. Multi-selection shows counts/types, common/mixed layers/style and bounds only when the coordinates share a frame, with at most 12 layer/source summary rows. Paper objects show Paper coordinates and readonly status, without MODEL edit fields.

Left dock contains DXF Views and Layers; right dock offers Properties/Search/AI switches. Clicking the selected switch again restores the combined overview. Both docks collapse to a compact rail; panels remain mounted to preserve search and AI drafts. Views retain exact source names and the 5 / 15 hierarchy. CloseButton uses the shared vector icon, 34 px hit target, hover/active/focus-visible and fixed dimensions. No additional global dismissal listeners are introduced.

## Unplaced tables

## View editing contract

- Paper-owned source geometry: readonly.
- MODEL through a supported active MODEL viewport: editable canonical MODEL entities, with the usual command/history/Undo paths.
- Source viewport geometry, scale/twist/center and VP Freeze: readonly metadata. Temporary view navigation does not edit these records or make the document dirty.

Plan rotation, North/georeference composition, view-relative ORTHO/Shift, MODEL-space grid snapping, rotated marquee and independent Plan/Axon/Paper cameras keep their existing behavior.
