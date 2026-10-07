# Shared editor Dialog contract

All user-facing React modal workflows use `src/components/Dialog.tsx`. Do not create independent backdrops, global Escape listeners, focus traps or workflow-specific modal shell CSS. Existing browser confirmations for discarding an unsaved document remain browser confirmations.

Structure: `DialogHeader` (title/subtitle/shared CloseButton), `DialogBody`, `DialogFooter`. Presets sm/md/lg/xl use 460/620/880/1200px maximum widths, bounded by the viewport. Only Body scrolls. Header/Footer remain visible; 390px mobile viewport uses 8px safe margins. Controls reuse editor typography/colors/focus-visible styling.

`src/editor/dialogs.ts` registers an ordered stack. The existing `useEditorFocus` event boundary owns pointer, keyboard and focus events; dialogs add no document listeners. Native inline nested editor popups retain their established peer/outside dismissal policy and consume the first Escape. The next Escape dismisses only the top dialog. `onDismiss` lets busy workflows cancel their Worker first, keeping review open; a subsequent Escape closes. Close/Cancel are explicit discards of transient work.

Initial focus prefers a relevant input/select, then the first enabled control; custom selectors are supported. Tab/Shift+Tab trap visible controls. Focus returns with `preventScroll` to the opener; if its details menu is closed, restore its visible summary. An explicit `focusAfterClose` workflow override is supported: choosing a Symbol intentionally starts canvas placement so R/Space work immediately; cancelling Symbols restores the opener. Text/numeric/search/AI fields retain normal text entry. Editor shortcuts do not act through a modal. Underlying page scroll is locked and prior overflow restored after the final dialog.

External nested popup content may identify the owning dialog via `data-popup-owner` matching the section ID; existing menus are inline. Modal IDs/labels, aria-modal, describedby, labelledby and close names are provided centrally. On close of a child dialog, focus returns to its opener inside the parent if focus is outside it. A replaced lazy-loading fallback leaves the workflow’s own initial text/select focus intact.

Migrated: Image Vectorization/Understanding, Teach/manage semantic knowledge, Symbols, DXF, Settings Center, PDF import, coordinate import, georeferencing and keyboard help, including lazy-loading fallbacks. Workflow content retains its own grids and controls; obsolete shells and separate traps are removed.

Regression coverage: `e2e/dialog-system.spec.ts`, existing semantic/underlay/georeferencing/import/Symbol/keyboard tests. Tests cover containment, narrow layouts, Body scroll with stable Header/Footer, Tab wraps, initial/restored focus, backdrop, nested popup Escape and text Space. Shared visual infrastructure is an invariant for future slices.

Settings and PDF reuse Header/Body/Footer and the single event boundary. PDF candidate content uses Body scrolling; no nested modal shell. Lazy PDF→image fallback is included in the allow-listed production offline assets. PDF cancel/unmount also guards async asset import before canonical Apply.
