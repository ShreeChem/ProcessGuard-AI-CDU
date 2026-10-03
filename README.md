# ProcessGuard-AI-CDU

> **Portfolio status:** Initial Phase / Engineering Prototype — created to demonstrate applied engineering, digitalization and AI-assisted development concepts.

ProcessGuard-AI-CDU is an engineering/AI portfolio prototype for an Atmospheric Crude Distillation Unit (CDU). It demonstrates how synthetic plant data, process-engineering logic, residuals, scenario response models and explainable diagnostic workflows can support operators and engineers without replacing the DCS, SIS or ESD.

## Live demo

https://processguard-cdu.hatchable.site/

## Current baseline

- **V17** (Preheat Health + physics-based F-101 model) is on `main`. Confirm the Hatchable live demo has been redeployed with V17 (it previously ran V16).
- V17 adds the **Preheat Health** module and the physics-based F-101 heater model (Arab Medium crude basis).
- Runtime files in `public/`: `index.html`, `styles.css`, `app.js`, `preheat-engine.js`, `preheat-ui.js`, `preheat.css`.
- Optional Python service in `backend/` (FastAPI, see `backend/README.md`) exposes the same F-101 heater physics. The dashboard does not need it: an identical JavaScript twin runs in the browser.
- Data: synthetic demonstration data only.

## Current scenarios

1. F-101 Heater Performance — gradual heat-transfer degradation / developing coil fouling or coking.
2. Reflux Valve Response — control-valve stiction / response mismatch.
3. E-201 Condenser Performance — reduced overhead heat-removal capability.
4. Column Hydraulic Loading — high feed / approach to hydraulic limitation.
5. Preheat Train Performance — exchanger fouling in E-101 … E-106, with a selectable cause: desalter upset, antifoulant pump stopped, unstable crude blend, or a single exchanger (local cause).

## Preheat Health module (V17)

- **Network model:** six counter-current ε-NTU exchangers in series (E-101 … E-106) heating desalted crude from 120 °C to the F-101 coil inlet; the residue loop (E-106 → E-105) is solved iteratively.
- **Fouling:** Ebert–Panchal-type threshold model (deposition rises with film temperature, suppression rises with velocity). Parameters are illustrative, not plant-fitted.
- **Synthetic history:** 12 months, hourly, historian-style tags with noise, crude switches, a desalter upset, an antifoulant outage, two past cleanings, a drifting transmitter and one missing temperature (estimated from the energy balance). Exportable as CSV.
- **Clean-baseline model (first trained model in ProcessGuard):** per-exchanger regression of ln UA on crude flow, hot flow and time, trained on the first 28 days after turnaround. Health % = actual UA ÷ predicted clean UA. Validated against the synthetic truth (R² 0.6–0.95 depending on exchanger).
- **Economics:** network-aware loss per exchanger, extra F-101 fuel, € and t CO₂ per day, heater firing margin, and a cleaning plan that minimises average cost per day with one exchanger offline at a time. Prices are editable placeholders.
- **Diagnostics:** rule-based root-cause hints from desalter salt, antifoulant rate, blend fouling index and the pattern of which exchangers accelerated. The F-101 firing residual stays near zero in this scenario, which separates preheat fouling from heater coil fouling.
- **UI:** six exchanger rings on the PFD, a detail panel per exchanger, a full Preheat Health page, preheat rows in Tag Explorer and Reports, English and German.

## Investigation workflow

`Detect -> Correlate -> Explain -> Forecast -> What-if -> Replay`

The application includes an operator view, engineer view, scenario testing, tag explorer, trends, DCS-alarm comparison, product/KPI views, evidence matrices, diagnostic ranking, recommended checks and event reconstruction.

## AI/ML positioning

V17 contains one lightweight trained model: the per-exchanger clean-baseline regression in the Preheat Health module, trained and validated on synthetic data only. The rest of the predictive layer is based on synthetic process-response calculations, physics (F-101 energy balance), residuals, diagnostic rules, engineering scoring and forecast logic. An Isolation Forest concept and expanded individual pumparound/side-stripper scenarios remain roadmap items rather than deployed capabilities.

## Safety boundary

- Read-only / advisory concept.
- No command is sent to DCS/SIS/ESD.
- What-if calculations are simulation-only.
- The prototype does not replace plant alarms, interlocks, operating procedures or engineering judgement.

## Run locally

Serve the `public/` directory with any static web server, for example:

```bash
python -m http.server 8080 --directory public
```

Then open `http://localhost:8080`.

Optional physics service (not required by the dashboard):

```bash
pip install -r backend/requirements.txt
cd backend && uvicorn api:app --host 127.0.0.1 --port 8000
```

Engine self-check: `node tools/validate-preheat.js`

## Version history

See `CHANGELOG.md` for the version history.

## Public-repository privacy

This repository is prepared for public publication. Do not add customer names, proprietary PFD/P&IDs, real plant values, customer network paths, credentials, confidential screenshots or restricted process data.

## License

No open-source license has been selected yet. Public visibility does not by itself grant reuse rights. Choose and add a license before inviting external reuse or contributions.

See `docs/` for architecture, data flow, roadmap, links and reconstruction notes.
