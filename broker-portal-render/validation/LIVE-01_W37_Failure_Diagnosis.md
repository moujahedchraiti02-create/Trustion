# LIVE-01 W37/26 Failure Diagnosis

## Integrity boundary
LIVE-01 remains immutable. This diagnosis was produced after the W37/26 outcome arrived and does **not** modify or retro-credit the frozen forecast.

## Observed live result
- Verified forecasts: 70 / 72
- Model MAE: 1.677 USD/mt
- Last benchmark MAE: 0.000 USD/mt
- Model bias: +1.035 USD/mt
- Interval coverage: 100.0%
- HIGH confidence MAE: 0.189 USD/mt
- LOW confidence MAE: 2.794 USD/mt

## Component diagnosis
The dominant W37 failure source is **Delta**, not Last, CargoCurve or RouteNeighbor.

- Last standalone MAE: 0.000
- Delta standalone MAE: 11.099
- RouteNeighbor standalone MAE: 3.795
- CargoCurve standalone MAE: 2.883 (where available)
- In LOW-confidence rows, Delta predicted on average +19.301 USD/mt above Last.
- After normalized ensemble weighting, Delta alone contributed on average +1.905 USD/mt to the LOW-confidence model uplift.
- RouteNeighbor contributed -0.116 USD/mt, partly offsetting Delta.
- CargoCurve average uplift contribution was effectively zero in W37.

Interpretation: the price error was primarily a **momentum / continuation overreach**. The ensemble carried forward a strong Delta continuation signal after a large W36 jump, while W37 printed a plateau.

## Historical context W31-W36
The untouched week-blocked holdout remains unchanged. The pattern is that simple persistence wins in quiet/flat weeks, while the ensemble adds value in large moves. Therefore a universal reduction of Delta would be unsafe.

## Candidate post-spike plateau guard v0.1
This is a **post-LIVE-01 hypothesis**, not a validated improvement and not part of the W37 score.

Trigger only when all are true before the target week:
1. Model confidence = LOW.
2. Prior aggregate WoW move >= 15 USD/mt.
3. No hard port-disruption flag in the prior evidence week.
4. Ensemble point estimate is > 1 USD/mt above Last.

Action:
- retain only 25% of the model uplift above Last;
- keep interval / uncertainty logic unchanged initially;
- require fresh broker/tonnage confirmation;
- log a `POST_SPIKE_PLATEAU_RISK` diagnostic flag.

W37 counterfactual (**not valid evidence**, because designed after observing W37):
- triggered forecasts: 26
- original MAE: 1.677
- counterfactual MAE: 0.725
- Last MAE: 0.000

## Retro-check W31-W36
The exact rule does not fire in W31-W36, so it does not damage the six-week holdout, but this also means those weeks **cannot validate the rule**.

W31 followed a large move but was HIGH confidence and associated with hard disruption; W34-W36 were LOW confidence but did not have a prior >=15 USD/mt aggregate jump.

## Scientific status
- LIVE-01 stays frozen and scored as originally issued.
- Plateau Guard v0.1 is a hypothesis created after LIVE-01.
- It must be frozen before W38 and judged prospectively on W38+.
- Do not claim the W37 counterfactual improvement as model performance.
