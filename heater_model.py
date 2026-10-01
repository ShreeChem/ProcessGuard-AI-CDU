"""
First-principles model for the F-101 crude charge heater.

This module answers one question ProcessGuard's frontend previously
answered with a fitted linear formula:

    "Given the current feed rate, preheat outlet temperature and
     furnace outlet setpoint, what firing % SHOULD be required,
     assuming a clean (unfouled) radiant coil?"

That "expected" value is the baseline the dashboard compares actual
firing against. When actual firing drifts above this baseline while
feed/preheat/setpoint are unchanged, the gap (the "firing residual")
is evidence of a heat-transfer problem such as coil fouling or coking
-- it is not, by itself, proof of the cause, only of a deviation from
what clean-coil physics predicts.

CRUDE BASIS -- Arab Medium
---------------------------
Properties below are for Arab Medium, Saudi Aramco's reference
medium/heavy sour crude, chosen because it is the most widely cited
crude of this class in refining literature -- defensible in front of a
technical audience without needing to justify an arbitrary choice.

  API gravity        : 30.9 deg API   (source: Energy Intelligence,
                        World Crude Oil Data, crude profile "Arab
                        Medium" -- energyintel.com/wcod/crude-profile/
                        arab-medium)
  Sulfur content      : 2.54 wt%      (same source)
  Specific gravity     : SG = 141.5 / (131.5 + API) = 0.8713  (standard
                        API gravity <-> SG conversion, API MPMS Ch.11.1)
  Density              : SG * 1000 = 871.3 kg/m3 at reference conditions
                        (temperature correction of density is NOT applied
                        here -- same simplification as before, now at
                        least starting from a real crude's reference
                        density instead of an arbitrary placeholder)

Scope and simplifications:
  - Energy balance only (Q = m_dot * Cp * dT); no rigorous VLE/TBP-based
    enthalpy calculation. Cp is now a temperature-dependent lumped value
    from a real correlation (below) rather than a single arbitrary
    constant, but it is still one lumped value representing the whole
    coil, not a per-cut enthalpy calculation.
  - Combustion efficiency and maximum fuel firing capacity are FURNACE
    equipment properties, not crude properties, and are still treated as
    constants for the "expected" (clean-coil) case. Combustion efficiency
    also drifts in reality (excess air, burner condition); that would be
    a separate residual, not modeled here.
  - The fouling-growth function further down is an ASYMPTOTIC
    THRESHOLD-FOULING curve in the spirit of the Ebert-Panchal
    formulation (deposition fastest early, slowing as the coil
    approaches an equilibrium fouling resistance). It reproduces the
    qualitative shape of that literature, not plant-calibrated rate
    constants -- flagged here, not hidden.
  - The corrosion trend function further down is QUALITATIVE, not a
    calibrated corrosion rate. See its own docstring for why.
"""

import math

# ---- Crude basis: Arab Medium -----------------------------------------
ARAB_MEDIUM_API = 30.9
ARAB_MEDIUM_SULFUR_WT_PCT = 2.54
ARAB_MEDIUM_SG = 141.5 / (131.5 + ARAB_MEDIUM_API)          # = 0.8713
ARAB_MEDIUM_DENSITY_KG_M3 = ARAB_MEDIUM_SG * 1000.0          # = 871.3

# ---- Furnace equipment constants (not crude-dependent) -----------------
COMBUSTION_EFFICIENCY = 0.89       # useful heat absorbed / fuel energy input
Q_MAX_FUEL_MW = 172.5              # calibrated max fuel firing capacity


def cragoe_specific_heat_kj_kgk(temp_c: float, sg: float = ARAB_MEDIUM_SG) -> float:
    """
    Liquid petroleum specific heat via the Cragoe (1929) correlation --
    the standard simplified correlation referenced in API Technical Data
    Book methodology for estimating Cp from specific gravity and
    temperature when no measured heat-capacity data is available:

        Cp [Btu/lb-F] = (0.388 + 0.00045 * T[F]) / sqrt(SG)

    Returns Cp in kJ/kg-K. This is a real, citable correlation, not a
    fitted constant -- but it is still an approximation: it does not
    distinguish between crude fractions (whole-crude vs a specific cut)
    and is only valid for the liquid phase (no partial vaporization
    correction), which matters more as temperature approaches the
    flash zone.
    """
    temp_f = temp_c * 9.0 / 5.0 + 32.0
    cp_btu_lbf = (0.388 + 0.00045 * temp_f) / math.sqrt(sg)
    return cp_btu_lbf * 4.1868  # Btu/lb-F -> kJ/kg-K


def expected_firing_pct(feed_m3h: float, preheat_c: float, furnace_sp_c: float,
                         sg: float = ARAB_MEDIUM_SG) -> float:
    """
    Expected firing % for a CLEAN coil at the given load -- a direct
    sensible-heat energy balance using Arab Medium's real density and a
    Cragoe-correlation Cp evaluated at the coil's mean film temperature:

        Q_useful       = m_dot * Cp(T_mean) * (T_out_target - T_in)
        fuel_required   = Q_useful / combustion_efficiency
        firing_pct      = 100 * fuel_required / Q_max_fuel
    """
    density = sg * 1000.0
    mass_flow_kgs = feed_m3h * density / 3600.0
    t_mean_c = (preheat_c + furnace_sp_c) / 2.0
    cp = cragoe_specific_heat_kj_kgk(t_mean_c, sg)
    delta_t_k = furnace_sp_c - preheat_c
    q_useful_kw = mass_flow_kgs * cp * delta_t_k
    q_useful_mw = q_useful_kw / 1000.0
    fuel_input_mw = q_useful_mw / COMBUSTION_EFFICIENCY
    return 100.0 * fuel_input_mw / Q_MAX_FUEL_MW


def implied_duty_mw(feed_m3h: float, preheat_c: float, furnace_sp_c: float,
                     sg: float = ARAB_MEDIUM_SG) -> float:
    """Useful heat duty (MW) implied by the same energy balance, for display."""
    density = sg * 1000.0
    mass_flow_kgs = feed_m3h * density / 3600.0
    t_mean_c = (preheat_c + furnace_sp_c) / 2.0
    cp = cragoe_specific_heat_kj_kgk(t_mean_c, sg)
    delta_t_k = furnace_sp_c - preheat_c
    return mass_flow_kgs * cp * delta_t_k / 1000.0


# ---- Roadmap: fouling-growth forecasting (not yet wired into the API) -----
# Kept here, tested, and ready to wire in as a second step: instead of only
# detecting that actual firing has drifted above the clean-coil baseline,
# this would let the backend also PREDICT how far the residual should grow
# over time for a given severity -- i.e. forecast the alarm window from
# physics rather than from a fitted curve. Good material for a "where this
# goes next" answer if asked.

def fouling_resistance(age_min: float, severity: float, tau_min: float = 9.0,
                        r_f_max: float = 1.0) -> float:
    """
    Asymptotic threshold-fouling curve (Ebert-Panchal-style shape):
    deposition is fastest early on and slows as the coil approaches an
    equilibrium fouling resistance. Returns a dimensionless resistance
    in [0, r_f_max * severity].

        R_f(t) = R_f_max * severity * (1 - exp(-t / tau))
    """
    return r_f_max * severity * (1.0 - math.exp(-age_min / tau_min))


def firing_with_fouling_pct(feed_m3h: float, preheat_c: float, furnace_sp_c: float,
                             age_min: float, severity: float,
                             fouling_sensitivity: float = 0.45,
                             sg: float = ARAB_MEDIUM_SG) -> float:
    """
    What firing % WOULD be required to still hit the same outlet setpoint
    as the coil fouls, given the resistance curve above. Effective heat
    transfer degrades as R_f grows:

        epsilon(t)          = 1 / (1 + fouling_sensitivity * R_f(t))
        firing_with_fouling  = expected_firing_pct(...) / epsilon(t)

    Not currently called by the API -- exposed for the next iteration
    (physics-based alarm-window forecasting) once the clean-coil baseline
    above has been validated against the frontend.
    """
    r_f = fouling_resistance(age_min, severity)
    epsilon = 1.0 / (1.0 + fouling_sensitivity * r_f)
    return expected_firing_pct(feed_m3h, preheat_c, furnace_sp_c, sg) / epsilon


# ---- Qualitative high-temperature sulfidic corrosion trend ----------------
# NOT a calibrated corrosion rate. Real high-temperature sulfidic corrosion
# rates for carbon/alloy steel are read off the modified McConomy curves
# (API RP 939-C, "Guidelines for Avoiding Sulfidation Corrosion Failures in
# Oil Refineries"). That standard is a paid API document; the underlying
# chart data is not something this module has access to, and fabricating
# curve-shaped coefficients to look precise would be dishonest. What IS
# public and well documented (corrosionpedia.com, citing API RP 939-C):
#   - The mechanism only becomes significant above ~500 F (260 C) metal
#     temperature.
#   - Corrosion rate increases with sulfur content and with temperature
#     above that threshold.
#   - The 1986 "modified" curves reduce the original 1961 McConomy curves
#     by a factor of ~2.5 (they had been over-predicting corrosion).
#   - Alloy matters enormously: 9Cr steel cuts the rate roughly 10x versus
#     carbon steel; 18Cr-8Ni (300-series stainless) lower still.
# The function below encodes only that STRUCTURE -- a zero-below-threshold,
# increasing-above-it trend, scaled by sulfur content -- as a relative
# index (0-100), not a mils-per-year rate. Label it as illustrative
# wherever it is displayed. Replace with real API RP 939-C chart values,
# or better, real corrosion-monitoring (UT thickness survey / coupon) data
# once available.

def corrosion_trend_index(metal_temp_c: float, sulfur_wt_pct: float = ARAB_MEDIUM_SULFUR_WT_PCT,
                           threshold_c: float = 260.0, ceiling_excess_c: float = 350.0) -> float:
    """
    Illustrative 0-100 relative index, NOT a calibrated corrosion rate.
    Zero at/below the McConomy threshold (260 C / 500 F); above it, rises
    with temperature excess and sulfur content, reaching 100 at
    threshold_c + ceiling_excess_c (610 C by default). That ceiling is
    chosen so this app's own tube-skin temperature tag -- baseline 465 C,
    rising toward ~497 C under strong F-101 fouling -- sits in a readable
    mid-range (roughly 59 -> 68) instead of pinning at the ceiling, so a
    developing trend is visible rather than an instantly-saturated alarm.
    That headroom choice, and the linear shape itself, are NOT derived
    from the actual McConomy chart and must not be read as mpy.

    Coupling note: tube-skin
    temperature is driven up by the SAME coil fouling the firing-residual
    evidence is already tracking -- fouling forces higher tube metal
    temperatures to maintain duty, which independently accelerates
    high-temperature sulfidic corrosion. These are two consequences of
    one mechanism, not two unrelated alarms.
    """
    if metal_temp_c <= threshold_c:
        return 0.0
    excess_c = metal_temp_c - threshold_c
    sulfur_factor = sulfur_wt_pct / ARAB_MEDIUM_SULFUR_WT_PCT  # =1.0 at Arab Medium
    raw = excess_c * sulfur_factor
    return max(0.0, min(100.0, raw * (100.0 / ceiling_excess_c)))


if __name__ == "__main__":
    # Quick manual sanity check -- see task 10 for the fuller version.
    base = expected_firing_pct(1000, 250, 382.5)
    print(f"Arab Medium SG={ARAB_MEDIUM_SG:.4f} density={ARAB_MEDIUM_DENSITY_KG_M3:.1f} kg/m3")
    print(f"Baseline expected firing at design point: {base:.2f}%")
    print(f"Implied duty at baseline: {implied_duty_mw(1000, 250, 382.5):.1f} MW")
    print(f"Corrosion index at 382.5C: {corrosion_trend_index(382.5):.1f} (illustrative, not mpy)")
