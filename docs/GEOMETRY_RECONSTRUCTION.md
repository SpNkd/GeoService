# CAD geometry reconstruction / deskew

Pipeline: alpha-on-white + illumination/threshold → connected components/text-region filtering → stroke chamfer distance BEFORE thinning → skeleton → contracted T/X branch clusters → raw paths → TLS/PCA Line → endpoint-constrained Arc / algebraic Circle → meaningful residual splits → topology-safe gap merge → Polyline/closed contour RDP fallback. Deterministic browser-local Worker; no ML dependency, Connector inference or engineering topology V3.

TLS measures orthogonal covariance residual, then checks the actual finite emitted segment. Raw endpoints remain exact so branch nodes and adjacent primitives share coordinates. Breakpoints use accumulated chord residual rather than each pixel turn. Arc acceptance requires ≥12 samples, radius ≥5 analysis pixels, sufficient angular sweep and radial residual; both ends constrain its circle. Full Circle requires closed path and ≥90% angular coverage. Arbitrary free curves retain fallback geometry; nonuniform MODEL scale converts circular candidates to a sampled contour rather than a fake circle.

Tolerance = clamped local median source width × detail factor; minimum noise allowance .9 px, width allowance capped at 4 px before detail. An explicit positive MODEL deviation cap is converted to analysis pixels using calibrated m/rectified-pixel and bounded downsample ratio. It bounds both fitting and fallback RDP. Below raster resolution this may increase fallback complexity, rather than promise better source accuracy. Endpoint gap ≤2.8 analysis pixels, angle dot >.999, perpendicular distance ≤1 px and actual combined source residual ≤both tolerances are required for merging. Shared endpoints never merge through T/X.

Metrics include raw traced vertices, final primitive count/control vertices and maximum/median sample-to-FINAL-primitive residual, after merge and fallback simplification. Pixel metrics are ANALYSIS pixels (edge ≤1200), not full-resolution source pixels. Circle has no polyline vertices; Arc counts its two implicit boundary points in this quality metric. Canonical Arc/Circle store center/radius/angles rather than Vertex IDs. T/X Lines share canonical Vertex IDs on Apply; arc branch endpoints remain geometrically coincident, without introducing new endpoint-reference or Connector semantics. Timings separate raw trace, fit and topology merge. Diagnostics → enable analysis → review allows a raw overlay capped at 25,000 vertices. Raw pixels/paths are transient, not canonical document data.

## Measured original fixtures

Same bounded rectified bitmap/settings compared against actual d547e16 extraction, with identical canonical conversion. 1080p examples (not an accuracy corpus):

| Fixture | Raw trace vertices | Before: entities / vertices | After: entities / vertices | max / median analysis px |
| --- | ---: | --- | --- | ---: |
| straight | 736 | 1 line / 2 | 1 line / 2 | 1.170 / 0.367 |
| corner | 773 | 1 polyline / 3 | 2 line / 4 | 0.000 / 0.000 |
| T | 986 | 3 line / 6 | 3 line / 6 | 0.000 / 0.000 |
| X | 1239 | 4 line / 8 | 4 line / 8 | 0.000 / 0.000 |
| arc | 406 | 1 polyline / 16 | 1 arc / 2 | 1.117 / 0.268 |
| circle | 898 | 1 circle / 0 | 1 circle / 0 | 0.802 / 0.237 |
| gap | 731 | 1 line / 2 | 1 line / 2 | 0.000 / 0.000 |

Straight and Circle were already good on these clean baseline fixtures. The measured improvement is Arc representation (16 vertices → one Arc / two boundary points), and a true corner becomes two shared Lines rather than one Polyline. T/X counts and shared ends remain correct; no claim that every baseline line was fragmented. The noisy 181-sample staircase unit fixture becomes one Line with two points and <1 px residual. Gap/parallel and free-curve rejection have separate tests.

## Distinct analysis rotation

Source raster remains immutable. Manual arbitrary numeric angle (°), ±.1°, ±90°, 180° act on analysis only. Dominant long-Line orientations modulo 90° yield a weighted suggestion only with ≥65% consistent support, minimum supported length and skew .15–15°. User must confirm; ambiguous data has no suggestion.

Mapping:

source --homography(source quad → perspective rectangle)--> perspective
--centered clockwise pixel rotation / expanded bbox--> analysis
--calibrated anisotropic scale, pixel Y inversion--> MODEL local offsets
--MODEL placement rotation + translation--> canonical geometry.

OCR projects analysis crops back through inverse centered deskew and inverse perspective homography, then reads original raster crops. Camera Plan rotation and SURVEY transform remain independent. Tests compose perspective + deskew + scale + MODEL placement against known points. Changing analysis rotation clears stale extraction/reference points; no source Blob edit occurs.

## Budget / reproduce

Bounded source buffer 1200×675×4 =3.24 MB for 16:9; native 8K decode bitmap estimate ≈132.7 MB. Browser/WASM process peak RSS is not measured by JS heap. Cancellation terminates the job Worker; 60s watchdog and candidate/fragment caps remain. Busy analysis never runs on pointer/hover.

Limits: dark line drawings on light backgrounds; downsampled small strokes, dense junctions, noise and perspective need review. No new connectivity, recognition semantics or remote image analysis. PDF native geometry uses its own direct operator adapter.

For the 1080p Arc fixture, canonical JSON falls from 4,488 to 1,637 bytes (63.5%); Line is unchanged at 1,887 bytes. The true corner grows from 2,044 to 2,352 bytes because two explicit Lines replace one Polyline. Candidate counts/control points are not unique canonical Vertex counts, and simplification is not a universal JSON-size decrease.
