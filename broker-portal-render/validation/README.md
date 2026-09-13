# STRIBROK historical validation dataset

This folder contains a normalized 2026 time series extracted from STRIBROK `FREIGHT REPORT - MAIN DIRECTIONS` PDFs for wheat SF47 / corn SF49 ex-Ukraine.

## Scope

- Weeks parsed: W02-W16, W18-W29, W31-W37 (34 weekly reports).
- W17 was not available in the selected library set.
- W30 could not be safely parsed from the PDF text layout and is deliberately excluded pending visual/manual verification.
- Routes: Turkish Black Sea, Marmara Turkey, East Mediterranean.
- Size buckets: 5,000-7,000 mt and 10,000-15,000 mt.
- 204 normalized route-size-week observations total.
- The current five-case broker pilot uses all cells except East Mediterranean 10,000-15,000 mt.

## Leakage policy

Historical STRIBROK observations may be used for baseline/backtest analysis, but they are not automatically an independent test of the current freight model if the model or its features were tuned with those same reports. Prospective W37+ predictions remain the strongest leakage-controlled evidence.

## Reproducible baselines on the five pilot cells

Only directly consecutive calendar weeks are scored.

- Previous-week persistence: n=155, MAE=1.2452 USD/mt, RMSE=3.3954, bias=-0.8065.
- 3-week rolling mean: n=125, MAE=2.4293 USD/mt, RMSE=4.8745, bias=-1.4480.

W37 only:

- Previous-week persistence: n=5, MAE=0.0, RMSE=0.0, bias=0.0.
- 3-week rolling mean: n=5, MAE=12.4, RMSE=12.5379, bias=-12.4.
- Frozen current model baseline: MAE about 4.53 USD/mt on the five W37 cases.

## Critical limitation

The repository currently contains the frozen W37 model outputs in the broker portal, but no reproducible historical inference pipeline or archived week-by-week model predictions were identified. Therefore this dataset does **not** claim a historical walk-forward score for the current model yet. Doing so without reconstructing the model as-of-time would risk hindsight leakage.
