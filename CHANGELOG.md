# Changelog

## V17

**Preheat Health module**
- New `preheat-engine.js`: 6-exchanger ε-NTU network model, Ebert–Panchal-type fouling, 12-month synthetic historian data, clean-baseline regression (health %, Rf, forecast), validation against synthetic truth, network-aware economics, cleaning optimiser, rule-based root-cause hints.
- New Preheat Health page, exchanger detail panel, six health rings on the PFD, historian CSV export, editable economic assumptions.
- Preheat scenario now has a cause (desalter upset / antifoulant stop / unstable blend / single exchanger) and exchanger selection in Scenario Testing and the Inject dialog.
- Preheat evidence, diagnostic ranking, operator checks, event map and forecast are cause-specific. Preheat rows added to Tag Explorer and Reports. German translations for all new text.

**Physics corrections**
- Preheat scenario: heater firing now follows the physics expected firing, so the firing residual stays near zero. Previously the scenario raised actual firing well above expected firing, which wrongly looked like heater coil fouling.
- Expected-firing fallback (used when the optional Python service is offline) is now the same energy balance as `heater_model.py` instead of a linear formula with 0.18 %-pt/°C. Physics gives about 0.43 %-pt firing and 0.66 MW absorbed duty per 1 °C of preheat.
- Preheat scenario score is based on CIT loss and exchanger health drop. DCS alarm forecast for preheat reads "None expected", because no DCS limit is configured on CIT.

**Physics heater model (V16.1)**
- Arab Medium crude basis (API 30.9, S 2.54 wt%, SG 0.8713), Cragoe Cp, physics F-101 expected firing (61.7 % / 94.7 MW at design), product split from the yield-vs-density table, illustrative sulfidic-corrosion trend index.
- Optional FastAPI service in `backend/` (`heater_model.py`, `api.py`).

## V16 — 14 September 2026

- Improved large-screen readability and viewing distance through desktop typography scaling.
- Increased text sizing across navigation, header/status areas, controls, cards, tables, trends, operator checks, engineering workspaces and dialogs for displays at 1200 px and above.
- Preserved the V15 HTML structure and simulation/diagnostic JavaScript logic unchanged.
- Restored the complete `public/app.js` runtime to the GitHub portfolio repository.
- Kept the application as a browser-only synthetic engineering prototype with no backend or database.

## V15 — 14 September 2026

- Established the portfolio baseline for ProcessGuard-AI-CDU.
- Five synthetic CDU disturbance scenarios.
- Operator and engineer workspaces, trends, scenario testing, tag explorer, alarm comparison, mass-balance/KPI views and AI explanation workspace.
- Evidence-first workflow: Detect → Correlate → Explain → Forecast → What-if → Replay.
- Read-only/advisory safety boundary; no DCS/SIS/ESD writeback.
