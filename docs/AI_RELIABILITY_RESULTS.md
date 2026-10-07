# AI reliability results — 2026-10-05

## Root cause findings

The previous dev endpoint mapped all exceptions to local HTTP502: actual upstream failure, invalid JSON/schema and local provenance rejection were indistinguishable. Earlier 9B diagnostics had already shown HTTP200 semantic errors (omitted site/invalid dependency or invented center) and an overly narrow center-language provenance guard. The preserved fix recognizes center synonyms and gives a complete generic structured example; no natural-language phrase matching or schema weakening was added.

Isolated instruct comparison initially returned 5 routing404 errors: `reasoning:{enabled:false}` plus `require_parameters:true` excluded every endpoint of the non-thinking model. Current [instruct endpoint capabilities](https://openrouter.ai/api/v1/models/qwen/qwen3-30b-a3b-instruct-2507/endpoints) do not list reasoning; [27B endpoints](https://openrouter.ai/api/v1/models/qwen/qwen3.5-27b/endpoints) do. Omitting reasoning universally caused 27B thinking to exceed the 30-second deadline in separate trials. These intermediate trials and an interrupted Vite-restart run were used for diagnosis, not pooled with the final sample.

Final configuration keeps primary reasoning disabled, uses compatible parameters for the explicit instruct fallback within the one allowed extra HTTP attempt, and excludes `siliconflow,atlas-cloud` through `AI_IGNORED_PROVIDERS` based on the repeated HTTP200 evidence. Three primary providers remain observed: Alibaba, DeepInfra and Phala. There is no single-provider pin and no automatic change of primary.

## Models and routing

Primary: `qwen/qwen3.5-27b`. Fallback: `qwen/qwen3-30b-a3b-instruct-2507`. Provider failover enabled; strict supported-parameter routing and `data_collection: deny`. Only explicit models; at most two application HTTP calls total, bounded backoff and 30-second overall deadline. Bad requests, auth, semantic/schema errors and deadline expiration never retry. Real-to-mock fallback does not exist. Model fallback consumes the existing retry allowance rather than adding another attempt.

## Final real smoke

Five runs per fixture through the local REAL endpoint on stable final routing. Success requires semantic correctness and ready deterministic local resolution for A–D; E requires clarification/unsupported without actions. D imports four points with **one** existing batch command and then creates a boundary, so the correct command count is two. An initial checker counted individual points as commands; saved results were reassessed locally without new API calls.

| Fixture | Runs | Correct / failed | Latency median (range), seconds | Actual model |
| --- | ---: | ---: | ---: | --- |
| A: 20×30 site, centered 6×5 house, four dimensions | 5 | 5 / 0 | 3.454 (2.366–3.520) | 27B |
| B: same meaning, “20 на 30”, “покажи размеры” | 5 | 5 / 0 | 3.372 (2.026–3.695) | 27B |
| C: 30×20 site, centered 5×6 house | 5 | 5 / 0 | 2.429 (2.021–3.062) | 27B |
| D: four explicit P1–P4 coordinates and boundary | 5 | 5 / 0 | 4.070 (2.426–5.211) | 27B |
| E: unspecified site, beds and gas pipe | 5 | 5 / 0 | 1.748 (1.706–2.343) | 27B |

25/25 correct; upstream502 = 0; other provider HTTP failures = 0; final local schema/provenance failures = 0. Every request used one application HTTP call; actual models: primary 25, fallback 0. Provider counts: Alibaba 9, DeepInfra 5, Phala 11. Overall median 2.461 s. This small sample establishes observed behavior, not a guarantee of future availability. Retry/fallback success is covered deterministically; no live fallback event was needed in this series.

## Isolated model comparison

Same A–E fixtures, one run each per model, no model fallback. Same privacy/explicit provider exclusions; model-compatible reasoning parameters. Primary remains unchanged.

| Model | Valid structured / semantic correct | Provider errors | Median latency (range), seconds | Returned providers |
| --- | ---: | ---: | ---: | --- |
| qwen/qwen3.5-27b | 5/5 · 5/5 | 0 | 4.231 (1.631–4.543) | Phala 3, Alibaba 2 |
| qwen/qwen3-30b-a3b-instruct-2507 | 5/5 · 5/5 | 0 | 2.818 (0.799–3.386) | Nebius 4, DekaLLM 1 |

## Diagnostics, errors and privacy

Last 20 requests, trace correlation UI→HTTP→validation→resolver→plan, actual/requested models, routing, each attempt, status/latency/bytes, raw and parsed output, separate Zod/provenance status, resolver/action count. Copy is redacted; data stays ephemeral. Diagnostics UI is absent from production.

502, timeout, rate limit, auth, bad request, schema and local validation have typed categories; only valid semantic unsupported becomes “Эта команда пока не поддерживается”. Errors offer explicit repeat of the original text and development details. Clarification stays a separate successful response. Editor document/history/dirty/autosave are unchanged by error, preview or diagnostics.

The model receives text, fixed instructions/schema and trace metadata. No GeoDocument or computed geometry is sent. Credentials, Authorization, cookies and known environment secrets never appear in logs/diagnostics/copy/bundle. Structured server logs omit raw text/output; client resolver reports contain only trace/status/count. No tool loop/calling was added; geometry/editor commands are unchanged.

## Verification

`npm run typecheck`, `npm run check` (lint, 370 unit tests, production build, 68 deterministic E2E), `npm audit --registry=https://registry.npmjs.org` (0 vulnerabilities). A fresh paid real browser smoke also passed: the exact A request produced a ready three-action preview, four house dimensions and no canonical/history/dirty mutation. It is separately opt-in via `AI_REAL_BROWSER_SMOKE=1`; standard CI skips it. Production checks confirm the existing key and diagnostic UI markers are absent. Manual REAL dev-server: <http://127.0.0.1:5173/>.
