"""
Minimal FastAPI service exposing the F-101 first-principles heater model
to ProcessGuard's frontend (app.js).

Run locally:
    pip install fastapi uvicorn --break-system-packages
    uvicorn api:app --host 0.0.0.0 --port 8000 --reload

Then open the dashboard (index.html) normally, e.g. via a static file
server on another port, or file://. CORS is left open (allow_origins=["*"])
because this is a local demo running on localhost, not a deployed service --
tighten this before it goes anywhere near a real network.

Endpoint:
    GET /expected-firing?feed=1000&preheat=250&furnace_sp=382.5
    -> {"expectedFiring": 55.02, "impliedDutyMW": 85.05, "source": "physics"}

If this service is not running, app.js falls back to its original
heuristic formula automatically -- the demo does not depend on the
network being up.
"""

from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware

from heater_model import (expected_firing_pct, implied_duty_mw, corrosion_trend_index,
                           ARAB_MEDIUM_API, ARAB_MEDIUM_SULFUR_WT_PCT)

app = FastAPI(title="ProcessGuard Physics Service", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/expected-firing")
def expected_firing(
    feed: float = Query(..., description="Crude feed rate, m3/h"),
    preheat: float = Query(..., description="Preheat train outlet temperature, C"),
    furnace_sp: float = Query(..., description="Furnace outlet setpoint, C"),
):
    return {
        "expectedFiring": round(expected_firing_pct(feed, preheat, furnace_sp), 3),
        "impliedDutyMW": round(implied_duty_mw(feed, preheat, furnace_sp), 2),
        "source": "physics",
        "crudeBasis": {"name": "Arab Medium", "apiGravity": ARAB_MEDIUM_API, "sulfurWtPct": ARAB_MEDIUM_SULFUR_WT_PCT},
    }


@app.get("/corrosion-trend")
def corrosion_trend(
    metal_temp: float = Query(..., description="Tube-skin (metal) temperature, C"),
    sulfur_wt_pct: float = Query(ARAB_MEDIUM_SULFUR_WT_PCT, description="Crude sulfur content, wt%"),
):
    return {
        "index": round(corrosion_trend_index(metal_temp, sulfur_wt_pct), 1),
        "note": "Illustrative 0-100 trend, NOT a calibrated mils-per-year rate -- see heater_model.py docstring.",
    }
