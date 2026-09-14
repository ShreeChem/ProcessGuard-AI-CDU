# ProcessGuard-AI-CDU

> **Portfolio status:** Initial Phase / Engineering Prototype — created to demonstrate applied engineering, digitalization and AI-assisted development concepts.

ProcessGuard-AI-CDU is an engineering/AI portfolio prototype for an Atmospheric Crude Distillation Unit (CDU). It demonstrates how synthetic plant data, process-engineering logic, residuals, scenario response models and explainable diagnostic workflows can support operators and engineers without replacing the DCS, SIS or ESD.

## Live demo

https://processguard-cdu.hatchable.site/

## Current baseline

- Official baseline: **Hatchable V16**
- V16 deployed: **14 September 2026**
- V16 is a focused **readability/UI patch**. The application logic and HTML structure are unchanged from V15; the stylesheet adds improved large-screen typography/readability.
- Runtime files in `public/`: `index.html`, `styles.css`, `app.js`.
- Data: synthetic demonstration data only.
- Current architecture: browser-only; no backend or database.

## Current scenarios

1. F-101 Heater Performance — gradual heat-transfer degradation / developing coil fouling or coking.
2. Reflux Valve Response — control-valve stiction / response mismatch.
3. E-201 Condenser Performance — reduced overhead heat-removal capability.
4. Column Hydraulic Loading — high feed / approach to hydraulic limitation.
5. Preheat Train Performance — heat-recovery degradation / exchanger fouling.

## Investigation workflow

`Detect -> Correlate -> Explain -> Forecast -> What-if -> Replay`

The application includes an operator view, engineer view, scenario testing, tag explorer, trends, DCS-alarm comparison, product/KPI views, evidence matrices, diagnostic ranking, recommended checks and event reconstruction.

## AI/ML positioning

The current V16 prototype does **not** contain a trained production ML model. Its predictive layer is based on synthetic process-response calculations, residuals, diagnostic rules, engineering scoring and forecast logic. An Isolation Forest concept and expanded individual pumparound/side-stripper scenarios remain roadmap items rather than deployed capabilities.

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

## Version history

See `CHANGELOG.md` for the V15 → V16 update history.

## Public-repository privacy

This repository is prepared for public publication. Do not add customer names, proprietary PFD/P&IDs, real plant values, customer network paths, credentials, confidential screenshots or restricted process data.

## License

No open-source license has been selected yet. Public visibility does not by itself grant reuse rights. Choose and add a license before inviting external reuse or contributions.

See `docs/` for architecture, data flow, roadmap, links and reconstruction notes.
