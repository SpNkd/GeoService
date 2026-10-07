# Settings Center / browser preferences

Toolbar **Настройки** opens the shared Dialog; assistant gear opens its AI section. One center: Общие / Редактор / AI / Приватность / Диагностика. Changes persist immediately; no global save button. The right assistant retains only workflow, compact provider status and gear. Developer renderer and AI diagnostics moved here; raw reconstruction overlay is gated by the Diagnostics preference. No new global focus or modal event listeners.

## Ownership and migration

PreferencesStore strict version1 (`geoservice.preferences.v1`) is separate from GeoDocument/IndexedDB autosave/JSON. It contains grid visibility, snap/grid enablement/step, ORTHO, last right tab, renderer/diagnostics and enabled/provider/model/fallback/timeout/retry. Existing standalone snap-step migrates. Missing/invalid/newer unknown schema falls back to defaults; a compatible renderer field uses its default. Preferences do not dirty the drawing or enter history. Toolbar/grid changes and defaults after a new/imported document synchronize with the editor.

Sidebar defaults to Properties; exactly one of Properties/Search/AI is visible. Panels remain mounted to preserve drafts/filters/selection. Last tab persists. Ctrl/Cmd+F selects Search/focuses query; AI toolbar action selects AI. Explicit Move/Rotate input commands reveal Properties. An active text field otherwise retains its normal focus. Numeric angle commits on Enter/blur through shared NumberField; editor pan/shortcuts continue to use the existing event boundary.

Cross-tab live synchronization is not implemented. Storage quota/unavailability leaves usable session settings and an honest warning; persistence is not guaranteed when browser storage rejects writes.

## Credentials and provider

Default remember-key checkbox OFF: key lives in tab memory and disappears on reload. Explicit ON writes only `geoservice.ai-device-key.v1` `{version,apiKey}` to this browser's localStorage; ordinary preferences and GeoDocument never contain its value. Unchecking removes stored key immediately, retaining it only for this tab session. Clear warning: browser-local persistence is not OS keychain and should not be used on a shared computer. Invalid keys are rejected; key field uses password/autocomplete off.

In DEV, `/api/ai/settings` returns public provider/model/fallback/hasApiKey only. Existing ignored `.env.local` stays untouched; empty UI key uses server credential. UI shows **Настроено локальным сервером**. Custom settings survive reload and are not overwritten by server defaults. Timeout1–120s controls browser waiting; backend separately bounds upstream. Optional one additional retry applies only to network transport errors, within the same abort signal; HTTP/schema/unsupported responses are not blindly retried.

## Privacy

Images, PDF bytes, geometry, layers, blocks, semantic metadata/entity IDs and preferences are never automatically included in remote AI payloads. DEV body is `{text}` with optional bounded structured clarification answers; production directly sends user text/answers and fixed parser prompt/schema to OpenRouter. Vision and remote OCR/conversion remain disabled. In DEV a user-entered API key goes in same-local-origin AI request headers; production uses the OpenRouter Authorization header directly; it is not added to diagnostics/logs. Local document/source processing remains browser-only.

## Tests

Settings E2E checks session/device opt-in/reload/uncheck, models/fallback/timeout/retry persistence, grid defaults, mobile bounds and unchanged document. Runtime units check strict provider headers, restore, custom-setting precedence and storage failure. Sidebar tests check exclusive visibility, drafts, Ctrl+F and text focus. Existing Dialog/popup/Space-pan regression tests remain enabled. Document-write counters in older AI tests exclude the separate preferences/key store, preserving their canonical autosave assertions.

Changing the active AI configuration cancels an in-flight parse and clears its old preview, matching the previous settings contract. Invalid credential drafts cannot start Test connection or persist via Remember; an error stays inside the shared Dialog. Connection feedback is tied to its own request and cannot overwrite a newer configuration.

Production has no `.env.local` or AI backend. No-key AI offers Settings while CAD remains usable. OCR assets resolve relative to the application base path; first use needs static resources, later offline use requires the recognition cache to have completed.
