# Architecture

## Current V15

```text
Synthetic CDU baseline + user-selected disturbance + severity
                         |
                         v
              Process-response calculations
                         |
        +----------------+----------------+
        |                |                |
        v                v                v
   Residuals         DCS-limit        KPI / mass
   & scoring          emulation        balance
        |                |                |
        +----------------+----------------+
                         v
             Diagnostic / forecast logic
                         |
                         v
   PFD + trends + evidence + checks + What-if + replay
```

The current deployment is a static browser application: `index.html`, `styles.css`, and `app.js`. There is no database, server-side model service or plant connection.

## V17 Preheat Health module

```text
preheat-engine.js (pure JS, no dependencies, runs in browser or Node)
  A physics     6 × ε-NTU exchangers in series + residue loop + EP-type fouling
  B data        12-month hourly synthetic historian (seeded, CSV export)
  C estimator   per-exchanger clean-baseline regression → Rf, health %, forecast
  D economics   loss attribution → fuel / CO2 / €, heater margin, cleaning plan
        |
preheat-ui.js  → Preheat Health page, exchanger panel, PFD rings
        |
app.js         → preheat scenario targets, score, evidence, ranking, tags, reports
```

The F-101 expected-firing energy balance exists twice with identical numbers: `backend/heater_model.py` (optional FastAPI service) and `expectedFiringPct()` in `preheat-engine.js` (always available in the browser).

## Target industrial architecture

```text
DCS / Historian / OPC UA -----> secured read-only ingestion layer
                                      |
UniSim-derived model -----------------+
                                      v
                         validation / quality layer
                                      |
                  +-------------------+------------------+
                  |                   |                  |
                  v                   v                  v
            physics model       anomaly model      forecast layer
                  |                   |                  |
                  +-------------------+------------------+
                                      v
                         evidence / explanation layer
                                      |
                                      v
                         ProcessGuard web interface
```

Any real plant connection requires plant cybersecurity review, tag governance, time synchronization, data-quality handling, change management and independent safety validation.
