# Selection transforms

The canonical `SelectionTransform` union owns translation and rotation. Existing Move uses the same topology resolver; rotation projects an immutable MODEL document snapshot. No SVG transform becomes document geometry. The design can gain uniform scale later; scale/mirror/custom pivots are outside this slice.

Plan selection has one combined bounds and a rotation grip, except a lone Point/Circle/derived Connector/Dimension whose self-rotation is meaningless. Default pivot is the combined MODEL bounds center. Pointer movement displays the delta angle, using `rotationSnapDeg = 15` with Shift. The preview lives in `selectionRotate.previewDocument`; the canonical document, autosave, dirty flag and history stay unchanged until release. Commit re-resolves locks and validates changed entity values and document references; one Undo step restores the exact base snapshot. Escape/pointer cancellation discards the preview. A full revolution is a no-op.

RO opens/focuses the numeric delta inspector. R retains the earlier symbol +90 shortcut, so its prefix waits for a possible O. Likewise MA captures visual style and M remains Move after the sequence timeout. The inspector has +90 counterclockwise/−90 clockwise/180 buttons, each one history action. A numeric group value is a transformation delta, not a common intrinsic orientation.

| Entity | MODEL XY rotation policy |
| --- | --- |
| Point/Line/Polyline/Polygon | Shared vertex coordinates transformed exactly once; MODEL Z preserved |
| Text | Anchor vertex rotates once; selected text intrinsic rotation adds delta |
| Arc | Center rotates; start/end angles add the delta in **radians**, radius unchanged |
| Circle | Center rotates in groups; no intrinsic angle |
| Symbol | Anchor and normalized intrinsic Z-axis angle; ports/routes derive from the symbol definition |
| BlockInstance | Insertion and intrinsic angle; shared definition remains referenced, no explosion. Legacy per-instance ATTRIB offsets migrate to block-local coordinates before rotation |
| Imported graphic | Owner position and its local primitive coordinates/orientation rotate; shared nested block definitions remain references |
| Raster underlay | Center and angle; asset, dimensions and opacity remain unchanged |
| Connector | Never independently transformed; route follows referenced symbols, even when connector is selected too |
| Dimension | Owns no source-vertex transform; updates associatively when geometry rotates |
| Label | Fully rotated target rotates its offset; a partially changed unselected target retains its label offset. Explicitly selected labels rotate their resolved position and compensate the derived anchor |

Selected and indirectly affected locked canonical consumers reject the whole transform. This includes shared-vertex entities, dependent labels and connected connectors. Symbol-definition allowed-angle constraints remain enforced. Deep nested primitives remain read-only.

Axon has no free rotation grip: a screen drag cannot choose a 3D axis. Single Text/Block/Symbol/Raster intrinsic numeric rotation remains MODEL Z rotation. Absolute Text/Block/Symbol edits use the shared transform policy around their anchor/insertion (including dependent locks and legacy ATTRIB conversion). For group/free rotation the UI says: «Свободное вращение доступно в виде План. В аксонометрии можно задать точный поворот вокруг оси Z.» Paper Space remains view/navigation only.

## Verification — transform/style/navigation slice, 2026-10-06

76 new unit/integration cases; full unit suite 981 passed / 75 opt-in skipped. Full Chrome suite 184 passed / 11 opt-in skipped. Cold-server acceptance with the actual reference DXF: 21/21, including all five source Paper Space containers and 2/2/3/6/2 MODEL viewport windows, active viewport layer badges, independent VP Freeze, immutable navigation, the six toolbar widths in Paper Space, native style/rotation and raster regressions. Monitored new/reference browser cases emitted zero console/page errors. Typecheck, lint, production build passed; npm audit found zero vulnerabilities. REAL OpenRouter returned a valid document-scoped building selection with HTTP 200. Runtime provider/model configuration and AI schemas were not changed.

The benchmark report separates domain median/p95 from single UI action/two-frame observations. Observed synthetic 100-entity UI latencies: rotate 34.7 ms, style 49.1 ms, layer style 31.0 ms, Match 28.6 ms. Reference block rotate 109.7 ms and style 47.1 ms; no unrelated shared definition recompilation. Paper navigation measurements include Playwright overhead. These local development timings are evidence, not a universal FPS or production guarantee.
