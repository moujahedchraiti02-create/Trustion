# LIVE-02 / W38-26 Pre-Outcome Freeze

- Source cutoff: **W37/26**
- Target: **W38/26**
- Freeze date: **2026-09-13**
- Benchmark rows frozen: **70**
- Benchmark: **Last Published Mid (W37 → W38)**
- Plateau Guard: **POST_SPIKE_PLATEAU_GUARD_v0.1 registered before W38 outcome**
- Freeze SHA-256: `2efbe9b1dc72cbab22f8984399e96697502797d53682804729b2eb1d94634dbb`

## Integrity boundary
No W38 STRIBROK outcome or later evidence may influence the W38 predictions.

## Current status
The benchmark arm is fully frozen for 70 series.

The incumbent MultiRouteEnsemble W38 predictions are intentionally **not fabricated**. The supplied artifacts preserve W37 frozen outputs and historical holdout component outputs, but do not provide a verified executable inference pipeline that can be rerun on W37-only inputs to generate W38.

The challenger rule is registered now, before W38 outcome, but its numeric forecast must be produced only after the base-model W38 rerun is available.

## W38 scoring
When W38 arrives, score:
1. Last benchmark.
2. Incumbent MultiRouteEnsemble.
3. Plateau-Guard challenger.
4. MAE/RMSE/bias.
5. Interval coverage.
6. Direction accuracy.
7. Confidence and route slices.

No post-outcome backfill is allowed.
