# ProcessGuard physics service (optional)

Small FastAPI service that exposes the F-101 crude heater energy balance used by the dashboard.
The dashboard does **not** need it: `public/preheat-engine.js` contains a JavaScript twin of
`expected_firing_pct()` that gives identical numbers (61.70 % firing / 94.7 MW at
1,000 m³/h, 250 °C preheat, 382.5 °C outlet). If the service runs on `localhost:8000`,
the dashboard uses it; otherwise it uses the in-browser twin.

## Model basis

- **Crude:** Arab Medium, API 30.9°, sulfur 2.54 wt% (Energy Intelligence, World Crude Oil Data).
  SG = 141.5 / (131.5 + API) = 0.8713 (API MPMS Ch. 11.1).
- **Heat capacity:** Cragoe (1929) correlation, Cp = (0.388 + 0.00045·T[°F]) / √SG, at the coil mean temperature.
- **Expected firing (clean coil):** Q = ṁ·Cp·ΔT, fuel = Q / 0.89, firing % = 100·fuel / 172.5 MW.
- **Sulfidic corrosion trend:** illustrative 0–100 index above the ~260 °C threshold
  (structure only, from public descriptions of API RP 939-C). It is **not** a calibrated
  corrosion rate in mpy.
- **Fouling growth curve:** asymptotic threshold-fouling shape, written and tested, not wired into the API.

## Run

```bash
pip install -r requirements.txt
uvicorn api:app --host 127.0.0.1 --port 8000
```

Endpoints:

- `GET /health`
- `GET /expected-firing?feed=1000&preheat=250&furnace_sp=382.5`
- `GET /corrosion-trend?metal_temp=465`

`python3 heater_model.py` runs a quick self-check.

CORS is open (`allow_origins=["*"]`) because this is a local demo service. Restrict it before
running it anywhere outside a local machine.
