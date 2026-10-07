# AI operations

GeoService keeps this pipeline: text → provider → structured semantic task → strict runtime validation → local deterministic resolver → preview → explicit Apply → existing commands. The model cannot execute commands or mutate a document. Tool calling/agent loops are deliberately excluded: interpretation is the only remote responsibility; geometry, references and authorization remain local.

## DEV launch

Create or update ignored `.env.local` without replacing an existing key:

```dotenv
AI_PROVIDER=openrouter
AI_PRIMARY_MODEL=qwen/qwen3.5-27b
AI_FALLBACK_MODELS=qwen/qwen3-30b-a3b-instruct-2507
AI_IGNORED_PROVIDERS=siliconflow,atlas-cloud,alibaba
OPENROUTER_API_KEY=<server-only key>
```

```sh
npm run dev -- --port 5173 --strictPort
# Deterministic named fixtures, no external calls:
npm run dev:mock -- --port 5173 --strictPort
```

Restart after changing environment configuration. Never use a `VITE_` prefix for secrets. Model defaults are shared in `src/ai/config.ts` (the DEV adapter reads the environment); `AI_PRIMARY_MODEL` takes precedence over the legacy `AI_MODEL`. Fallbacks are comma-separated; an explicitly empty `AI_FALLBACK_MODELS` disables model fallback. There is no unknown-model or implicit mock fallback. Optional legacy OpenAI Responses adapter uses `AI_PROVIDER=openai`, `AI_MODEL` and `OPENAI_API_KEY`.

## OpenRouter routing

Chat Completions receives an explicitly configured `model`, strict `response_format: json_schema` and `temperature: 0`. Provider preferences: `allow_fallbacks: true`, `require_parameters: true`, `data_collection: deny`. No provider pin/order is used.

Parameter compatibility is checked locally against the configured known model capabilities: 27B supports `reasoning: {enabled:false}`; the instruct fallback endpoints do not. A shared request with reasoning plus `require_parameters: true` would exclude all instruct endpoints. Omitting reasoning entirely made 27B thinking slow enough to exceed the 30-second deadline in real trials. The final adapter disables reasoning for 27B, then uses the **one allowed extra HTTP call** on a retryable failure to request the configured instruct fallback with compatible parameters. It never adds a third call. Without configured fallback, this call retries primary. Compatible native fallback models are passed through `models` in their explicit configured order; the instruct fallback request also permits OpenRouter failover across its eligible providers. Returned model/provider and each HTTP requested model are recorded separately; internal OpenRouter routing attempts are not invented.

`AI_IGNORED_PROVIDERS` is an optional comma-separated configuration. The tested `.env.local`/example uses `siliconflow,atlas-cloud,alibaba`: the initial audit repeatedly received HTTP200 word-list boundary output instead of rectangles from SiliconFlow, and array-wrapped JSON from AtlasCloud. The spatial audit additionally recorded Alibaba returning `unsupported` inside `intent` in repeated HTTP200 responses despite the canonical schema/full prompt examples (4/5 A failed in the stable before-routing run). Alibaba is excluded for the same evidenced contract failure. These are structured/semantic failures, not 502s. Exclusion is based on this recorded fixture evidence, does not pin a single provider, and leaves provider failover enabled. Other eligible providers remain available for each model. Set the variable empty to repeat the original routing comparison.
Verified against official documentation on 2026-10-05: [model fallbacks](https://openrouter.ai/docs/guides/routing/model-fallbacks), [provider routing](https://openrouter.ai/docs/guides/routing/provider-selection), [structured outputs](https://openrouter.ai/docs/guides/features/structured-outputs). Requiring parameter support does not guarantee semantic correctness; local validation remains mandatory.

## Retry and timeout

The server adapter makes at most two HTTP calls per request (one initial call and one retry/fallback). Only network failures and HTTP 502/503/504/429 are retryable. Backoff is 250 ms. A provided Retry-After must be valid and at most one second; longer/invalid values suppress retry. Auth, other 4xx, malformed structured output, unsupported, provenance rejection and deadline expiration never retry. The browser never automatically retries. The explicit Retry button submits the original failed text as a new trace.

A single 30-second deadline bounds all upstream attempts, backoff and response streaming. AbortController propagates browser cancellation, disconnect and timeout. A browser runner also has a 30-second deadline. Late responses cannot overwrite a newer request. No state is persisted or mutated until Apply.

## Trace and diagnostics

A local `ai-…` ID starts in the UI and passes in `X-AI-Trace-ID` to the local endpoint and upstream HTTP request. It follows schema validation, resolver and plan IDs. The response echoes this header and diagnostic ID. Request JSON contains text and optional bounded structured clarification answers; the trace is metadata, not a document ID.

In development, open **Settings → Диагностика** for AI Diagnostics. It retains the last 20 requests in memory, including pending requests, and updates by trace ID. Fields include timestamp, redacted text, configured models, routing preferences, HTTP attempt details, requested/returned model, returned provider when available, latency, HTTP status, byte count, raw response/error preview, parsed result, separate schema and literal-provenance validation statuses, resolver status and action count. Mock is explicitly labelled `provider: mock`; zero upstream HTTP attempts is expected.

**Copy diagnostics** copies redacted JSON. **Подробнее** on a failed request shows its trace and category. Raw content remains development-only and ephemeral; it is not written to the drawing, history, autosave or localStorage. The UI component is lazy-loaded under `import.meta.env.DEV` and absent from a production bundle. The endpoint is a Vite development plugin, not a production AI deployment.

Server logs contain concise JSON with trace, requested/actual model, provider, attempt count, status, latency, parse and error category. The client reports only trace/resolver status/action count to the strict local resolution-log endpoint; no document or geometry is reported. Resolver logs follow the same trace, since actual document resolution takes place in the browser.

## Error taxonomy

| Category | Meaning | Automatic retry |
| --- | --- | --- |
| NETWORK_ERROR | Transport failure | Once |
| TIMEOUT | Overall deadline expired | No |
| RATE_LIMIT | HTTP 429 | Once only with bounded Retry-After |
| UPSTREAM_5XX | Upstream HTTP 5xx | Once only for 502/503/504 |
| AUTH_ERROR | Missing credentials or HTTP 401/403 | No |
| BAD_REQUEST | Request/configuration rejected, other 4xx | No |
| INVALID_STRUCTURED_OUTPUT | Invalid JSON/envelope/schema/budget | No |
| UNSUPPORTED | Valid successful semantic unsupported response | No |
| LOCAL_VALIDATION_ERROR | Schema-shaped response fails literal provenance | No |

Clarification is a separate successful semantic result with bounded questions. Valid structured output is still checked for literal coordinates/names/sizes and backward dependencies. Local resolver errors remain visible in the preview and block Apply. A valid response can also be semantically wrong despite passing structural validation; real smoke tests check this separately.

Local HTTP responses distinguish upstream failure (502), timeout (504), rate limit (429), auth (401), bad request (400), and invalid/local semantic output (422). Diagnostics preserve the actual upstream status, so HTTP200→local422 is distinguishable from upstream502→local502. Unsupported is never inferred from a transport error. User messages explain the category, state that the drawing was not changed, and offer an explicit repeat when appropriate.

## Privacy

Only bounded user-entered text and a fixed schema/prompt reach the model; a trace header supports correlation. GeoDocument, layers, IDs, history, selection, resolver choices and calculated coordinates never reach it. Coordinates explicitly typed by the user are part of their text. Provider storage/training routes are constrained with `data_collection: deny` in addition to account privacy preferences.

Authorization is sent only by the server to the selected API; it is never collected as telemetry. Cookies and header/environment objects are not collected. Known server secret values and secret-like fields, bearer tokens and API key patterns are redacted before responding, storing diagnostics or copying. Server logs omit raw text, raw output and error bodies. Error previews are bounded to 16 KiB, upstream responses to 256 KiB and semantic content to 96 KiB. Production static assets contain neither credentials, server prompt nor diagnostic UI.

## Verification and real smoke

```sh
npm run typecheck
npm run check
npm audit --registry=https://registry.npmjs.org
# Explicit opt-in paid test; REAL local dev server must already be running:
AI_REAL_SMOKE=1 npm run bench:ai-reliability
```

Results and root-cause findings for this slice are recorded in `docs/AI_RELIABILITY_RESULTS.md`.

## Spatial Placement

Use the same REAL `.env.local`, primary/fallback and bounded transport strategy. Do not launch `dev:mock` for natural-language checks. Anchored sketch positions are semantic outputs; the local resolver chooses a non-normative inset and displays assumptions before Apply. Coordinates/sizes/datum needed for engineering geometry require clarification; a known north/west/corner relation with known sizes does not require exact sketch offsets.

Canonical wire states are `{intent:{actions:[...]},unsupported:false}`, `{intent:{status:"needs_clarification",questions:[...]},unsupported:false}` and `{intent:null,unsupported:true}`. Both adapters/client use the same strict envelope helper; older `{intent}` is explicitly compatible. Extra fields and contradictory flags are rejected. Clarification is schema-valid with zero actions and no error code. A HTTP200 upstream response that violates schema still becomes local422, without retry or document effects.

```sh
# REAL server already running from ignored .env.local:
AI_SPATIAL_SMOKE=1 npm run bench:ai-spatial
```

The initial 30-call run exposed misplaced nested `unsupported` fields, one invented point origin and one contradictory null/false response. All were blocked locally. The prompt was corrected to full canonical examples and an explicit missing-coordinate policy; strict validation was preserved. A stable subsequent run exposed repeated nested-flag errors on A from Alibaba; routing now additionally ignores that endpoint. Primary/fallback models, compatible reasoning settings, transport retries, provider failover and strict parsing remain unchanged. No provider pin/order was introduced. Exact per-run outcomes follow below.

### Recorded spatial results (2026-10-05)

Final configured routing: **30/30 expected outcomes**, schema/local validation valid in every row; no clarification for A–D. All actual models were `qwen/qwen3.5-27b`; Phala handled 26 calls, DeepInfra 4. Every call used one upstream HTTP attempt; the configured instruct fallback remains available, but was not needed. This is fixture evidence, not a service reliability guarantee.

| Case | Success | Returned state | Actions | Relation | Median latency | Range |
| --- | --- | --- | --- | --- | --- | --- |
| A | 5/5 | supported | 3 | north | 5.687 s | 5.117–13.088 s |
| B | 5/5 | supported | 3 | north | 10.937 s | 4.904–13.283 s |
| C | 5/5 | supported | 2 | west | 5.012 s | 4.390–12.276 s |
| D | 5/5 | supported | 2 | north_east | 5.015 s | 4.411–10.810 s |
| E | 5/5 | needs_clarification | 0 | — | 2.839 s | 2.737–8.033 s |
| F | 5/5 | needs_clarification | 0 | — | 3.591 s | 2.741–8.200 s |

Initial run: 23/30 expected outcomes (six malformed/contradictory envelopes and one locally blocked invented point coordinate). Intermediate prompt run: 23/30 (three malformed west envelopes plus four local Vite-restart connection failures). The west-specific full-example probe passed 5/5, including Alibaba. A later stable before-routing run passed 26/30: all four failures were A from Alibaba, which placed `unsupported` inside `intent`. Those raw redacted responses remain recorded. Excluding Alibaba via the existing ignore preference produced the final 30/30; no malformed output is repaired or silently accepted.

Final deterministic checks: `npm run typecheck`, `npm run check` (444 unit, 84 E2E passed, one existing paid real E2E opt-in skipped), production build, `npm audit --registry=https://registry.npmjs.org` (0 vulnerabilities). Browser console/page errors: 0. North preview was visually inspected: child inside/north/horizontally centered with 1 m inset and four dimensions. Existing Zod PURE annotation warnings remain; the production main chunk is about 512 kB and Vite warns above 500 kB. No bundling work was added in this slice.

## Spatial smoke A–F

Новые supported semantics: existing-object relative/inside rectangle, along-edge Polyline, rectangle array 1–50. Current layer/selection остаются локальными. Имена в fixture: Дом, Участок; duplicates require local chooser. Provider mode real не подменяется mock.

`AI_SPATIAL_REAL_SMOKE=1 npx vitest run src/tests/spatial-real-smoke.test.ts` читает существующую .env.local и выполняет A–F (платная проверка). Результаты model/provider/schema/latency и semantic plan сохраняются в /private/tmp/geoservice-spatial-real-smoke.json; ключ не выводится. Ordinary check skips paid cases. [Текущий отчёт и ограничения](SPATIAL_AI.md).

## Document operations

[AI Document Operations](AI_DOCUMENT_OPERATIONS.md) adds strict intent/query variants beside Spatial AI. Natural requests always create preview first; exact owner IDs are resolved locally. Current configuration/key and bounded primary/fallback routing are reused. `AI_DOCUMENT_REAL_SMOKE=1 npx vitest run src/tests/document-operations-real.test.ts` is an explicit paid opt-in (A–H × 5), outside CI. Manual search has no provider dependency. Whole-layer visibility mutations obey full-coverage checks and the manual visibility policy; partial results use temporary isolation. Neither model input nor output contains document/catalog/selection IDs.

## Static production

Production has no Vite API or server credential. Settings → AI accepts a visitor OpenRouter key; the browser transport shares the same strict parser/schema/routing/local resolution. Without a key CAD works and AI offers configuration. Remember is OFF by default; explicit ON stores a separate browser-local key record. See [Pages deployment](PAGES_DEPLOYMENT.md) and [Settings](SETTINGS_PREFERENCES.md). Release REAL opt-in corpus and measured failures are in [acceptance](REAL_WORLD_ACCEPTANCE.md).
