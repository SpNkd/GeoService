# Working Plan orientation

The Plan camera has an optional temporary `rotationDeg`. The default is zero. `GeoDocument.viewport`, MODEL XYZ, SURVEY EN/H, georeference, provenance, document revision, history and dirty state never receive this angle. North Up resets the working angle; Fit and Fit Selection preserve it. The Plan camera survives Axon and Paper navigation independently of the Axon preset and paper camera.

`geometry/worldToScreen` and its inverse subtract the stable camera center before rotation. Pan, anchored zoom, Canvas affine transforms, SVG primitives, raster corners, selection contours, marquee and grid share that projection. Bounds use all four inverse-projected screen corners, avoiding the two-corner axis-aligned culling error in rotated views. Fit measures projected box corners around a stable midpoint. Coordinates retain precision at the reference's million-metre origin.

The View control offers an angle, North Up and two snapped points for horizontal/vertical alignment. The first point displays a guide; coincident points are rejected and Escape cancels without history. Drawing ORTHO and Shift 45° use the working view basis; grid snapping continues in true MODEL coordinates. A screen-vertical ORTHO line can therefore have both true MODEL X and Y deltas. Marquee remains a screen rectangle and projects candidate geometry before testing.

North is obtained from SURVEY north through the valid rigid MODEL-to-SURVEY transform and then the working camera. Without a reference it uses MODEL +Y. Stale control references fall back to MODEL +Y and retain existing reference warnings. An angle never changes a calibrated reference or absolute height.

Paper remains aligned to the sheet. Each imported MODEL viewport keeps its source twist. Active viewport editing uses that source presentation; there is no temporary viewport twist editor and no persisted viewport modification in this slice.

Active MODEL viewport Space-pan and anchored zoom use temporary MODEL center/scale, preserve the sheet camera and imported viewport metadata, and reset on exit. Scope/hit/snap follow the temporary window. Fit resets this temporary navigation; source twist and VP Freeze remain intact. Controlled floating palettes register with the shared popup boundary; keyboard-focused controls keep native keyboard interaction.

Escape inside active MODEL cancels the current marquee/transaction before a subsequent Escape exits to the sheet. Text form UI stays within the visible viewport clip; its position does not alter the text anchor or source viewport.
