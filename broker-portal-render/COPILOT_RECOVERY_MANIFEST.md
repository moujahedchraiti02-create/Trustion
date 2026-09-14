# Dry Bulk Freight Intelligence Copilot — Recovery & Continuity Manifest

Date: 2026-09-14
Status: CONTEXT RECOVERED / WORK PRESERVED

## 1. What exists already
The Dry Bulk Freight Intelligence Copilot was already built before the current recovery work. It is not a new build.

Core product scope:
- Route / commodity / cargo / vessel selection
- Fair midpoint pricing
- Fair range
- Confidence
- Canonical market regime
- Decision-support output
- Explanation layer
- Audit & evidence linkage
- Broker-check requirement
- Model component visibility
- Validation snapshot
- Live no-leakage validation workflow

## 2. Original Copilot baseline
Original artifact: Dry_Bulk_Freight_Intelligence_Copilot_MVP.html
Original live cutoff: Week 36/26
Series linked: 72
Canonical regime at cutoff: CONFIRMED_TIGHTENING
Evidence snapshot: f97118dc6231bca7
State machine: v1.0
Traceability chain:
Copilot price -> Canonical regime -> Frozen evidence snapshot -> Live validation ledger

The end-to-end audit integration explicitly preserved the existing point-price forecasts.

## 3. Core pricing model
Promoted point model: MultiRouteEnsemble
Architecture:
- Last
- Delta
- CargoSizeCurve
- RouteNeighbor / RouteSimilarity

Historical model artifact metrics:
- Backtest rows: 2,198
- Series tested: 72
- Last MAE: 1.91 USD/mt
- Delta MAE: 2.45 USD/mt
- MultiRoute ensemble MAE: 1.35 USD/mt

Recovered ensemble raw weights:
- Last: 0.40
- Delta: 0.10
- CargoCurve: 0.30
- RouteNeighbor: 0.30
Weights normalize across available components.

Recovered Delta rule:
Delta = Last + 0.825*(Last - Prev2) + 0.175*(Prev2 - Prev3)

## 4. Validation stack already built
Existing artifacts include:
- Dry_Bulk_Freight_Scientific_Validation_Framework
- Dry_Bulk_Confidence_Calibration_Engine
- Dry_Bulk_Regime_Adaptive_Confidence_Intervals
- Dry_Bulk_Cargo_Size_Curves_Route_Similarity
- Freight_Intelligence_Validation_Lab
- Freight_Intelligence_3Axis_Regime_Detector
- Freight_Intelligence_Early_Regime_Detector
- Freight_Intelligence_Transmission_Score
- Freight_Intelligence_Narrative_Dynamics_Transmission
- Freight_Intelligence_Causal_Operational_EarlyWarning
- Freight_Intelligence_Decision_Engine
- Dry_Bulk_Live_NoLeakage_Test_01
- Dry_Bulk_Copilot_EndToEnd_Audit_Integration
- Dry_Bulk_Canonical_Regime_State_Machine

## 5. LIVE-01 / W37 result
W37 was the first prospective no-leakage live cycle after cutoff W36.

Closure summary:
- Forecasts: 72
- Published outcomes available: 70
- Model MAE: 1.6773 USD/mt
- Model RMSE: 2.4725
- Model bias: +1.0347
- Last benchmark MAE: 0.0000
- Interval coverage: 100%
- Direction accuracy: 40%

Interpretation:
W37 was effectively a plateau week across the 70 comparable published series. The failure mode was momentum continuation / failure to detect plateau, not a collapse of the overall model.

Component diagnosis:
- Last: perfect for W37 plateau
- Delta: primary source of overprediction
- RouteNeighbor: partial offset
- CargoCurve: not the main problem

## 6. Plateau Guard
Candidate: POST_SPIKE_PLATEAU_GUARD_v0.1
Scientific status: POST_LIVE_01_HYPOTHESIS_NOT_VALIDATED

Trigger requires all:
1. model confidence LOW
2. prior-week aggregate move >= 15 USD/mt
3. prior-week port_disruption == 0
4. point estimate uplift over Last > 1 USD/mt

Action:
Guarded midpoint = Last + 0.25*(Model - Last)

This rule must remain a challenger until validated prospectively. It must not rewrite LIVE-01.

## 7. W37 reconstruction of the point engine
The missing executable point-model logic was recovered from the original artifacts and validated against the frozen W37 Copilot outputs.

Audit result on 70 non-stale series:
- 53/70 matched to the cent
- 68/70 within +/-0.01 USD/mt
- max point difference: 0.02 USD/mt
- mean absolute reconstruction difference: about 0.0027 USD/mt

Conclusion: the point-estimate pipeline is sufficiently recovered for prospective continuity.

## 8. LIVE-02 / W38 status
W38 point forecasts were frozen before outcome ingestion.

Target: Week 38/26
Source cutoff: Week 37/26
Comparable series: 70
Point-model freeze: completed
Last benchmark freeze: completed
Plateau Guard challenger: registered

Important integrity rule:
No W38 outcome or later market evidence may be used to alter the already frozen W38 point forecasts.

## 9. Broker-validation portal
Live service:
https://dry-bulk-validation-portal.onrender.com

Purpose:
Independent blind-first broker validation.

State:
- Render service live
- PostgreSQL persistence active
- 5 published W37 outcome rows stored
- 0 broker submissions so far
- Artur / STRIBROK invite exists in the live service

This portal is a validation surface, not a replacement for the Copilot product.

## 10. Source-of-truth hierarchy going forward
1. Original Copilot artifacts in Library = product baseline and design truth
2. Frozen LIVE-01 and LIVE-02 files = experimental truth
3. GitHub branch broker-validation-portal = operational validation code / continuity docs
4. Neon = broker reviews and outcome ledger
5. STRIBROK weekly reports = Tier-2 published market assessment, not confirmed fixture ground truth

## 11. What must NOT happen
- Do not rebuild the Copilot from scratch.
- Do not rewrite W37 results.
- Do not backfill W38 forecasts after W38 is known.
- Do not promote Plateau Guard based on W37 counterfactuals.
- Do not call STRIBROK published assessments confirmed actual fixtures.
- Do not merge post-outcome changes into pre-outcome baselines without explicit versioning.

## 12. Next valid step
Wait for / ingest W38 outcomes, then close LIVE-02 against the frozen W38 predictions.

Score:
- MAE
- RMSE
- Bias
- Direction accuracy
- Interval coverage if the original confidence/range pipeline is used unchanged
- results by confidence
- results by route / direction
- Last vs recovered MultiRoute
- challenger vs incumbent if challenger was frozen pre-outcome

Only after LIVE-02 closure should any model change be considered.
