# Roadmap / Future Improvements

## Data and integration

- DCS read-only connector.
- Historian connector.
- OPC UA ingestion and tag-quality monitoring.
- UniSim-derived process-model synchronization.
- Secure plant/DMZ deployment pattern.

## Analytics

- Validate a genuine anomaly-detection layer using historical/validated simulation data.
- Revisit Isolation Forest as one candidate, with documented training, validation and false-positive analysis.
- Model individual Pumparound disturbances.
- Model individual side-stripper disturbances.
- Add model-health and drift validation tied to real data-quality metrics.
- Replace heuristic forecast tables with validated dynamic models where appropriate.

## Preheat Health (after V17)

- Cold preheat train (before the desalter).
- Hydraulic fouling limits (exchanger ΔP) and pump constraints.
- Heater tube coking model coupled to preheat CIT.
- Calibrate fouling parameters and the clean-baseline model on real historian data.
- Replace the linear fouling-rate forecast with a fitted threshold-fouling model per exchanger.
- Corrosion-rate prediction from real API RP 939-C data or inspection results (currently qualitative only).

## Engineering governance

- Tag dictionary and units governance.
- Scenario acceptance test matrix.
- Alarm philosophy alignment.
- Cybersecurity and safety review.
- Model-management/versioning procedure.

Roadmap items are not claimed as deployed V15 features.
