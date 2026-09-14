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
