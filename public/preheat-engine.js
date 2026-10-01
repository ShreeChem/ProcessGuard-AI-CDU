/*
 * ProcessGuard V17 — Preheat Health engine
 * ----------------------------------------
 * Synthetic demonstration model of a CDU hot preheat train (E-101 … E-106).
 * Browser + Node compatible, no dependencies.
 *
 * Layers
 *   A  Physics:   counter-current ε-NTU exchangers in series, residue loop coupling,
 *                 Ebert–Panchal-type threshold fouling rates.
 *   B  Data:      seeded 12-month hourly historian-style history (synthetic).
 *   C  Estimator: per-exchanger clean-baseline regression → Rf estimate, health %, forecast.
 *   D  Economics: network-aware loss attribution, fuel / CO2 / €, heater margin,
 *                 cleaning-cycle optimisation with one-exchanger-offline constraint.
 *
 * All numbers are illustrative defaults for a demonstration unit, not plant data.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PreheatEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ------------------------------------------------------------------ *
   * Constants and configuration
   * ------------------------------------------------------------------ */
  const R_GAS = 8.314;          // J/mol·K
  const E_ACT = 48000;          // J/mol — activation energy, within the 28–68 kJ/mol range reported for crude fouling
  const FILM_FRACTION = 0.55;   // film temperature position between bulk and wall (common EP simplification)

  // Crude basis matches backend/heater_model.py: Arab Medium, API 30.9, S 2.54 wt%.
  const ARAB_MEDIUM_SG = 141.5 / (131.5 + 30.9);            // 0.8713
  const DEFAULTS = {
    crudeVol: 1000,          // m³/h (baseline feed)
    crudeSG: ARAB_MEDIUM_SG, // –
    crudeRho: ARAB_MEDIUM_SG * 1000, // kg/m³ = 871.3
    desalterT: 120,          // °C (feedTemp)
    furnaceSP: 382.5,        // °C (F-101 outlet setpoint)
    heaterEff: 0.89,         // – combustion efficiency (heater_model.py)
    qMaxFuel: 172.5,         // MW fired at 100 % firing (heater_model.py)
    practicalMaxFiring: 90,  // % — ASSUMED practical firing limit (editable)
    fuelPrice: 35,           // €/MWh fired — placeholder, editable
    co2Factor: 0.202,        // t CO2/MWh fired (natural-gas factor; refinery fuel gas differs)
    co2Price: 70,            // €/t — placeholder, set to current EUA price
    cleanCost: 80000,        // € per bundle cleaning incl. access/hydroblast — placeholder, editable
    cleanDays: 3,            // days offline (bypassed) per cleaning
    healthGreen: 85,         // %
    healthAmber: 70          // %
  };

  // Exchanger design basis. designOut = crude outlet at clean design (°C).
  // hotIn / hotFlow for residue exchangers: residue enters E-106 first, then E-105.
  // Hot-stream SG values are ASSUMED typical cut gravities (Cragoe Cp input).
  // Residue flow = 450 m³/h (Arab Medium yield split in app.js) × assumed 950 kg/m³ = 118.75 kg/s.
  const EXCHANGERS = [
    { id: 'E-101', hot: 'PA-1',    hotSG: 0.80, hotIn: 180, hotFlow: 100,    designOut: 144.3, U: 380, foulYr: 0.00025, wall: 0.10 },
    { id: 'E-102', hot: 'PA-2',    hotSG: 0.84, hotIn: 215, hotFlow: 110,    designOut: 171.3, U: 370, foulYr: 0.00035, wall: 0.10 },
    { id: 'E-103', hot: 'PA-3',    hotSG: 0.87, hotIn: 250, hotFlow: 100,    designOut: 195.3, U: 360, foulYr: 0.00050, wall: 0.10 },
    { id: 'E-104', hot: 'PA-4',    hotSG: 0.90, hotIn: 285, hotFlow: 85,     designOut: 216.3, U: 340, foulYr: 0.00080, wall: 0.10 },
    { id: 'E-105', hot: 'Residue', hotSG: 0.95, hotIn: null, hotFlow: 118.75, designOut: 237.3, U: 280, foulYr: 0.00130, wall: 0.10 },
    { id: 'E-106', hot: 'Residue', hotSG: 0.95, hotIn: 340, hotFlow: 118.75, designOut: 256.8, U: 270, foulYr: 0.00180, wall: 0.10 }
  ];
  const RESIDUE_IN = 340;

  // Liquid heat capacity, Cragoe (1929): Cp[Btu/lb·F] = (0.388 + 0.00045·T[°F]) / √SG → kJ/kg·K.
  // Same correlation as backend/heater_model.py.
  const cragoe = (T, sg) => (0.388 + 0.00045 * (T * 9 / 5 + 32)) / Math.sqrt(sg) * 4.1868;
  const cpCrude = T => cragoe(T, ARAB_MEDIUM_SG);

  const crudeMass = vol => vol * DEFAULTS.crudeRho / 3600;        // kg/s

  /* ------------------------------------------------------------------ *
   * Seeded RNG
   * ------------------------------------------------------------------ */
  function rng(seed) {
    let s = seed >>> 0;
    const next = () => { s += 0x6D2B79F5; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const randn = () => { let u = 0, v = 0; while (u === 0) u = next(); while (v === 0) v = next(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
    return { next, randn };
  }

  /* ------------------------------------------------------------------ *
   * Layer A — physics
   * ------------------------------------------------------------------ */
  // Counter-current effectiveness
  function effectiveness(NTU, Cr) {
    if (NTU <= 0) return 0;
    if (Math.abs(1 - Cr) < 1e-6) return NTU / (1 + NTU);
    const e = Math.exp(-NTU * (1 - Cr));
    return (1 - e) / (1 - Cr * e);
  }

  // Solve one exchanger. UA in kW/K, flows kg/s. Returns outlet temps and duty (kW).
  function solveExchanger(UA, mc, Tci, mh, Thi, hsg) {
    hsg = hsg || 0.9;
    if (UA <= 0 || mh <= 0 || Thi <= Tci) return { Tco: Tci, Tho: Thi, Q: 0 };
    let Tco = Tci + 20, Tho = Thi - 20, Q = 0;
    for (let k = 0; k < 4; k++) {
      const Cc = mc * cpCrude((Tci + Tco) / 2);
      const Ch = mh * cragoe((Thi + Tho) / 2, hsg);
      const Cmin = Math.min(Cc, Ch), Cmax = Math.max(Cc, Ch);
      const eps = effectiveness(UA / Cmin, Cmin / Cmax);
      Q = eps * Cmin * (Thi - Tci);
      Tco = Tci + Q / Cc;
      Tho = Thi - Q / Ch;
    }
    return { Tco, Tho, Q };
  }

  // Clean UA as a function of flows: 1/UA = Rc(mc) + Rh(mh) + Rw, film resistances ∝ m^-0.8.
  // filmMult > 1 = worse crude-side film (e.g. more viscous blend) — hidden from the estimator.
  function cleanUA(ex, mc, mh, filmMult) {
    const rc = ex.rc0 * Math.pow(ex.mcRef / mc, 0.8) * (filmMult || 1);
    const rh = ex.rh0 * Math.pow(ex.mhRef / mh, 0.8);
    return 1 / (rc + rh + ex.rw0);
  }

  // Actual UA with fouling Rf (m²K/W). 1 m²K/W = 1000 m²K/kW.
  function actualUA(ex, mc, mh, Rf, filmMult) {
    return 1 / (1 / cleanUA(ex, mc, mh, filmMult) + (Rf * 1000) / ex.area);
  }

  // Build model: calibrate clean design UA so clean outlets hit designOut, derive area and resistances.
  function buildModel(opts) {
    const o = Object.assign({}, DEFAULTS, opts || {});
    const mc = crudeMass(o.crudeVol);
    const exs = EXCHANGERS.map(e => Object.assign({}, e));
    // Calibrate sequentially along the crude path. Residue: E-106 is upstream on the hot side,
    // so calibrate E-106 given its crude inlet (= E-105 design out) first.
    const Tin = [o.desalterT].concat(exs.map(e => e.designOut));
    const calib = (ex, Tci, Thi) => {
      const target = ex.designOut;
      let lo = 1, hi = 5000;
      for (let k = 0; k < 80; k++) {
        const mid = (lo + hi) / 2;
        const r = solveExchanger(mid, mc, Tci, ex.hotFlow, Thi, ex.hotSG);
        if (r.Tco < target) lo = mid; else hi = mid;
      }
      return (lo + hi) / 2;
    };
    exs[5].UAd = calib(exs[5], Tin[5], RESIDUE_IN);
    const resMid = solveExchanger(exs[5].UAd, mc, Tin[5], exs[5].hotFlow, RESIDUE_IN, exs[5].hotSG).Tho;
    exs[4].hotIn = resMid;
    for (let i = 0; i < 5; i++) exs[i].UAd = calib(exs[i], Tin[i], exs[i].hotIn);
    exs.forEach(ex => {
      ex.area = ex.UAd * 1000 / ex.U;                 // m²
      const Rtot = 1 / ex.UAd;
      ex.rw0 = ex.wall * Rtot;
      ex.rc0 = 0.45 * Rtot;
      ex.rh0 = 0.45 * Rtot;
      ex.mcRef = mc;
      ex.mhRef = ex.hotFlow;
    });
    const model = { o, exs, mcDesign: mc };
    // Design film temperatures for the fouling-rate reference.
    const clean = solveTrain(model, { Rf: [0, 0, 0, 0, 0, 0] });
    exs.forEach((ex, i) => {
      ex.TfRef = filmT(clean.ex[i]);
      const daily = ex.foulYr / 365;
      ex.alpha = daily / 0.7;      // deposition term
      ex.gamma = 0.3 * ex.alpha;   // suppression (shear) term, so net design rate = foulYr
    });
    model.cleanCIT = clean.CIT;
    return model;
  }

  function filmT(r) {
    const Tc = (r.Tci + r.Tco) / 2, Th = (r.Thi + r.Tho) / 2;
    return Tc + FILM_FRACTION * 0.5 * (Th - Tc);   // wall ≈ midway for balanced film resistances
  }

  /*
   * Solve the whole train.
   * cond: { Rf:[6], crudeVol, desalterT, hotFlowMult:[6], hotInDelta:[6], offline:[6 bool] }
   */
  function solveTrain(model, cond) {
    const o = model.o, exs = model.exs;
    const mc = crudeMass(cond.crudeVol != null ? cond.crudeVol : o.crudeVol);
    const Tdes = cond.desalterT != null ? cond.desalterT : o.desalterT;
    const Rf = cond.Rf || [0, 0, 0, 0, 0, 0];
    const fm = cond.hotFlowMult || [1, 1, 1, 1, 1, 1];
    const dT = cond.hotInDelta || [0, 0, 0, 0, 0, 0];
    const off = cond.offline || [];
    const fmult = cond.filmMult || 1;
    const res = new Array(6);
    let Tc = Tdes;
    for (let i = 0; i < 4; i++) {
      const ex = exs[i], mh = ex.hotFlow * fm[i], Thi = ex.hotIn + dT[i];
      const UA = off[i] ? 0 : actualUA(ex, mc, mh, Rf[i], fmult);
      const r = solveExchanger(UA, mc, Tc, mh, Thi, ex.hotSG);
      res[i] = { Tci: Tc, Tco: r.Tco, Thi, Tho: r.Tho, Q: r.Q, UA, mh };
      Tc = r.Tco;
    }
    // Residue loop: crude E-105 → E-106, residue E-106 → E-105. Fixed-point on residue mid temperature.
    const mhR = exs[5].hotFlow * fm[5];
    const ThiR = RESIDUE_IN + dT[5];
    const UA5 = off[4] ? 0 : actualUA(exs[4], mc, mhR, Rf[4], fmult);
    const UA6 = off[5] ? 0 : actualUA(exs[5], mc, mhR, Rf[5], fmult);
    let resMid = ThiR - 45, r5, r6;
    for (let k = 0; k < 30; k++) {
      r5 = solveExchanger(UA5, mc, Tc, mhR, resMid, exs[4].hotSG);
      r6 = solveExchanger(UA6, mc, r5.Tco, mhR, ThiR, exs[5].hotSG);
      if (Math.abs(r6.Tho - resMid) < 1e-4) { resMid = r6.Tho; break; }
      resMid = r6.Tho;
    }
    res[4] = { Tci: Tc, Tco: r5.Tco, Thi: resMid, Tho: r5.Tho, Q: r5.Q, UA: UA5, mh: mhR };
    res[5] = { Tci: r5.Tco, Tco: r6.Tco, Thi: ThiR, Tho: r6.Tho, Q: r6.Q, UA: UA6, mh: mhR };
    return { ex: res, CIT: r6.Tco, mc };
  }

  // Ebert–Panchal-type net fouling rate (m²K/W per day).
  function foulingRate(ex, r, mc, mult) {
    const Tf = filmT(r) + 273.15, TfRef = ex.TfRef + 273.15;
    const vr = mc / ex.mcRef;                        // velocity ratio (tube side crude)
    const dep = ex.alpha * mult * Math.pow(vr, -0.66) * Math.exp(-E_ACT / R_GAS * (1 / Tf - 1 / TfRef));
    const sup = ex.gamma * Math.pow(vr, 1.8);
    return Math.max(0, dep - sup);
  }

  // F-101 expected firing — JS twin of heater_model.expected_firing_pct.
  function expectedFiringPct(o, feedVol, preheat, furnaceSP) {
    const mc = feedVol * o.crudeRho / 3600;
    const cp = cpCrude((preheat + furnaceSP) / 2);
    const qMW = mc * cp * (furnaceSP - preheat) / 1000;
    return { firing: 100 * (qMW / o.heaterEff) / o.qMaxFuel, dutyMW: qMW, firedMW: qMW / o.heaterEff };
  }

  // Heater impact of a fouled CIT versus clean CIT at the same throughput and setpoint.
  function heaterImpact(model, CIT, mc, cleanCIT) {
    const o = model.o;
    const feedVol = mc * 3600 / o.crudeRho;
    const clean = expectedFiringPct(o, feedVol, cleanCIT, o.furnaceSP);
    const now = expectedFiringPct(o, feedVol, CIT, o.furnaceSP);
    const dFired = now.firedMW - clean.firedMW;                 // MW fired
    const perDay = dFired * 24;                                  // MWh fired / day
    const marginPct = o.practicalMaxFiring - now.firing;         // %-pt to practical limit
    let feedAtRisk = 0;
    if (now.firing > o.practicalMaxFiring) feedAtRisk = feedVol * (1 - o.practicalMaxFiring / now.firing);
    return {
      dAbs: now.dutyMW - clean.dutyMW, dFired, duty: now.dutyMW, firing: now.firing, cleanFiring: clean.firing,
      marginPct, feedAtRisk,
      fuelEur: perDay * o.fuelPrice,
      co2t: perDay * o.co2Factor,
      co2Eur: perDay * o.co2Factor * o.co2Price,
      totalEur: perDay * (o.fuelPrice + o.co2Factor * o.co2Price),
      mwPerDegC: mc * cpCrude(cleanCIT) / 1000,
      firingPerDegC: 100 * (mc * cpCrude(cleanCIT) / 1000 / o.heaterEff) / o.qMaxFuel
    };
  }

  /* ------------------------------------------------------------------ *
   * Layer B — synthetic 12-month history
   * ------------------------------------------------------------------ */
  const HISTORY_DAYS = 365;
  const INJECT_DAYS = 14;   // an injected cause acts over the most recent two weeks
  const K_INJ = { desalter: 9, antifoulant: 7, blend: 4, local: 14 };

  // Event script for the demonstration year (day index from start).
  const EVENTS = [
    { type: 'turnaround', day: 0, text: 'Start of run: all exchangers clean after turnaround' },
    { type: 'clean', day: 150, ex: 5, text: 'E-106 cleaned (bypassed 3 days)' },
    { type: 'desalter', day: 200, days: 6, text: 'Desalter upset: high salt / solids carry-over' },
    { type: 'clean', day: 240, ex: 4, text: 'E-105 cleaned (bypassed 3 days)' },
    { type: 'antifoulant', day: 290, days: 10, text: 'Antifoulant injection pump stopped' }
  ];

  function tagNames() {
    const t = ['timestamp', 'FI_CRUDE_M3H', 'TI_DESALTER_OUT', 'AI_DESALTER_SALT_PTB', 'FI_ANTIFOULANT_LH', 'LAB_BLEND_FOULING_IDX'];
    EXCHANGERS.forEach(e => {
      const n = e.id.replace('-', '');
      t.push(`${n}_TCO`, `${n}_THI`, `${n}_THO`);
    });
    t.push('FI_PA1_KGS', 'FI_PA2_KGS', 'FI_PA3_KGS', 'FI_PA4_KGS', 'FI_RESIDUE_KGS');
    return t;
  }

  /*
   * generateHistory(model, {seed, extraMult, endDate})
   * Returns { hours:[...], days:[...], events, truth }.
   * The E-105/E-106 residue intermediate temperature (E106_THO = E105_THI) is NOT measured —
   * it is left blank in the historian export and estimated from the energy balance.
   */
  function generateHistory(model, opts) {
    opts = opts || {};
    const R = rng(opts.seed || 20260924);
    const end = opts.endDate ? new Date(opts.endDate) : new Date('2026-09-24T00:00:00Z');
    const start = new Date(end.getTime() - HISTORY_DAYS * 86400000);
    const Rf = [0, 0, 0, 0, 0, 0];
    let visc = 1, feed = 1000, hotW = [0, 0, 0, 0, 0, 0], blend = 1.0, blendLeft = 0, lastClean = [0, 0, 0, 0, 0, 0];
    const hours = [], truthDaily = [];
    const offlineUntil = [-1, -1, -1, -1, -1, -1];
    const blendLevels = [0.85, 1.0, 1.0, 1.15, 1.35];
    for (let h = 0; h < HISTORY_DAYS * 24; h++) {
      const day = h / 24;
      const dayIdx = Math.floor(day);
      // drivers
      if (blendLeft <= 0) { blend = blendLevels[Math.floor(R.next() * blendLevels.length)]; visc = 1 + (R.next() - 0.5) * 0.12; blendLeft = (7 + R.next() * 14) * 24; }
      blendLeft--;
      feed += (1000 - feed) * 0.01 + R.randn() * 2.2;
      feed = Math.min(1045, Math.max(915, feed));
      hotW = hotW.map(w => w * 0.98 + R.randn() * 0.004);
      const inj = opts.injected && day >= HISTORY_DAYS - INJECT_DAYS ? opts.injected : null;
      const sev = inj ? ({ mild: 1, medium: 2, strong: 3.5 }[inj.severity] || 2) : 0;
      const desUpset = EVENTS.some(e => e.type === 'desalter' && day >= e.day && day < e.day + e.days) || (inj && inj.cause === 'desalter');
      const afStop = EVENTS.some(e => e.type === 'antifoulant' && day >= e.day && day < e.day + e.days) || (inj && inj.cause === 'antifoulant');
      if (inj && inj.cause === 'blend') blend = 1.3 + 0.1 * sev;
      EVENTS.forEach(e => { if (e.type === 'clean' && h === e.day * 24) { offlineUntil[e.ex] = h + DEFAULTS.cleanDays * 24; } });
      const offline = offlineUntil.map(u => h < u);
      offline.forEach((isOff, i) => { if (isOff) { Rf[i] = 0; lastClean[i] = dayIdx; } });
      const fm = hotW.map(w => 1 + w);
      const dT = [R.randn() * 0.4, R.randn() * 0.4, R.randn() * 0.4, R.randn() * 0.4, 0, R.randn() * 0.5];
      const cond = { Rf: Rf.slice(), crudeVol: feed, hotFlowMult: fm, hotInDelta: dT, offline, filmMult: visc };
      const s = solveTrain(model, cond);
      // fouling growth for next hour
      for (let i = 0; i < 6; i++) {
        if (offline[i]) continue;
        let mult = blend;
        if (desUpset) mult *= inj && inj.cause === 'desalter' ? 1 + K_INJ.desalter * sev : 2.4;
        if (afStop && i >= 3) mult *= inj && inj.cause === 'antifoulant' ? 1 + K_INJ.antifoulant * sev : 1.9;
        if (inj && inj.cause === 'local' && i === inj.ex) mult *= 1 + K_INJ.local * sev;
        if (inj && inj.cause === 'blend' && i >= 3) mult *= 1 + K_INJ.blend * sev;
        if (opts.extraMult) mult *= opts.extraMult[i] || 1;
        Rf[i] += foulingRate(model.exs[i], s.ex[i], s.mc, mult) / 24;
      }
      // sensors (noise; the residue intermediate TI is not installed)
      const n = (sd) => R.randn() * sd;
      const row = {
        t: new Date(start.getTime() + h * 3600000),
        day,
        feed: feed * (1 + n(0.006)),
        Tdes: model.o.desalterT + n(0.25),
        salt: (desUpset ? 9 + R.next() * 6 : 1.2 + R.next() * 0.8),
        antifoulant: afStop ? 0 : 18 + n(0.6),
        blend,
        ex: s.ex.map((r, i) => ({
          Tco: r.Tco + n(0.3) + (i === 3 ? 0.8 * day / HISTORY_DAYS : 0),
          Thi: (i === 4) ? null : r.Thi + n(0.3),
          Tho: (i === 5) ? null : r.Tho + n(0.3),
          mh: r.mh * (1 + n(0.01)),
          offline: offline[i]
        })),
        _truth: { Rf: Rf.slice(), CIT: s.CIT, mc: s.mc }
      };
      hours.push(row);
      if (h % 24 === 23) truthDaily.push({ day: dayIdx, Rf: Rf.slice(), lastClean: lastClean.slice() });
    }
    return { start, end, hours, events: EVENTS.map(e => Object.assign({ date: new Date(start.getTime() + e.day * 86400000) }, e)), truthDaily };
  }

  function historyToCSV(hist) {
    const lines = [tagNames().join(',')];
    hist.hours.forEach(r => {
      const v = [r.t.toISOString().slice(0, 16), r.feed.toFixed(1), r.Tdes.toFixed(2), r.salt.toFixed(2), r.antifoulant.toFixed(1), r.blend.toFixed(2)];
      r.ex.forEach(e => v.push(e.Tco.toFixed(2), e.Thi == null ? '' : e.Thi.toFixed(2), e.Tho == null ? '' : e.Tho.toFixed(2)));
      [0, 1, 2, 3, 5].forEach(i => v.push(r.ex[i].mh.toFixed(2)));
      lines.push(v.join(','));
    });
    return lines.join('\n');
  }

  /* ------------------------------------------------------------------ *
   * Layer C — clean-baseline estimator
   * ------------------------------------------------------------------ */
  // Measured UA from temperatures + flows (counter-current LMTD). Missing residue
  // intermediate temperature is reconstructed from the crude-side duty.
  function measuredDaily(model, hist) {
    const days = [];
    for (let d = 0; d < HISTORY_DAYS; d++) {
      const rows = hist.hours.slice(d * 24, d * 24 + 24);
      const acc = { feed: 0, salt: 0, af: 0, blend: 0, ex: EXCHANGERS.map(() => ({ UA: [], mc: [], mh: [], Q: [], Tco: [], Thi: [], Tho: [], off: false, est: false })) };
      rows.forEach(r => {
        const mc = crudeMass(r.feed);
        acc.feed += r.feed / rows.length; acc.salt += r.salt / rows.length; acc.af += r.antifoulant / rows.length; acc.blend += r.blend / rows.length;
        const Tci = [r.Tdes].concat(r.ex.map(e => e.Tco));
        // E-106 first to rebuild residue mid temperature
        const qCrude = i => mc * cpCrude((Tci[i] + Tci[i + 1]) / 2) * (Tci[i + 1] - Tci[i]);
        const q6 = qCrude(5);
        const Thi6 = r.ex[5].Thi, mh6 = r.ex[5].mh;
        const resMid = Thi6 - q6 / (mh6 * cragoe(Thi6 - 35, EXCHANGERS[5].hotSG));
        for (let i = 0; i < 6; i++) {
          const e = r.ex[i];
          if (e.offline) { acc.ex[i].off = true; continue; }
          const Thi = i === 4 ? resMid : e.Thi;
          const Tho = i === 5 ? resMid : e.Tho;
          const Q = qCrude(i);
          const d1 = Thi - Tci[i + 1], d2 = Tho - Tci[i];
          if (d1 <= 0.5 || d2 <= 0.5 || Q <= 0) continue;
          const lmtd = Math.abs(d1 - d2) < 1e-6 ? d1 : (d1 - d2) / Math.log(d1 / d2);
          const a = acc.ex[i];
          a.UA.push(Q / lmtd); a.mc.push(mc); a.mh.push(e.mh); a.Q.push(Q);
          a.Tco.push(Tci[i + 1]); a.Thi.push(Thi); a.Tho.push(Tho);
          if (i >= 4) a.est = true;
        }
      });
      const mean = arr => arr.reduce((s, x) => s + x, 0) / (arr.length || 1);
      days.push({
        day: d, date: new Date(hist.start.getTime() + d * 86400000),
        feed: acc.feed, salt: acc.salt, antifoulant: acc.af, blend: acc.blend,
        ex: acc.ex.map(a => ({
          off: a.off && a.UA.length < 12,
          n: a.UA.length,
          UA: mean(a.UA), mc: mean(a.mc), mh: mean(a.mh), Q: mean(a.Q),
          Tco: mean(a.Tco), Thi: mean(a.Thi), Tho: mean(a.Tho), est: a.est
        }))
      });
    }
    return days;
  }

  // Ordinary least squares with small ridge penalty: X rows → y.
  function ridge(X, y, lambda) {
    const p = X[0].length;
    const A = Array.from({ length: p }, () => new Array(p).fill(0));
    const b = new Array(p).fill(0);
    X.forEach((row, k) => {
      for (let i = 0; i < p; i++) { b[i] += row[i] * y[k]; for (let j = 0; j < p; j++) A[i][j] += row[i] * row[j]; }
    });
    for (let i = 1; i < p; i++) A[i][i] += lambda;
    // Gaussian elimination
    for (let i = 0; i < p; i++) {
      let piv = i; for (let r = i + 1; r < p; r++) if (Math.abs(A[r][i]) > Math.abs(A[piv][i])) piv = r;
      [A[i], A[piv]] = [A[piv], A[i]]; [b[i], b[piv]] = [b[piv], b[i]];
      for (let r = i + 1; r < p; r++) { const f = A[r][i] / A[i][i]; for (let c = i; c < p; c++) A[r][c] -= f * A[i][c]; b[r] -= f * b[i]; }
    }
    const w = new Array(p).fill(0);
    for (let i = p - 1; i >= 0; i--) { let s = b[i]; for (let c = i + 1; c < p; c++) s -= A[i][c] * w[c]; w[i] = s / A[i][i]; }
    return w;
  }

  const TRAIN_DAYS = 28;

  /*
   * Train per-exchanger clean baselines on the first TRAIN_DAYS after the turnaround.
   * Model: ln UA = b0 + b1 ln(mc/mref) + b2 ln(mh/mhref) + b3·t   → clean prediction uses t = 0.
   * Including time lets the model separate early fouling from the flow effect.
   */
  function trainBaselines(model, days) {
    return model.exs.map((ex, i) => {
      const X = [], y = [];
      days.slice(0, TRAIN_DAYS).forEach(d => {
        const e = d.ex[i];
        if (e.off || !e.n) return;
        X.push([1, Math.log(e.mc / ex.mcRef), Math.log(e.mh / ex.mhRef), d.day / 30]);
        y.push(Math.log(e.UA));
      });
      const w = ridge(X, y, 1e-6);
      const pred = X.map(r => r.reduce((s, x, j) => s + x * w[j], 0));
      const resid = y.map((v, k) => v - pred[k]);
      const sd = Math.sqrt(resid.reduce((s, r) => s + r * r, 0) / Math.max(1, resid.length - 4));
      return { w, sd, nTrain: X.length };
    });
  }

  function predictCleanUA(model, base, i, mc, mh) {
    const ex = model.exs[i], w = base[i].w;
    return Math.exp(w[0] + w[1] * Math.log(mc / ex.mcRef) + w[2] * Math.log(mh / ex.mhRef));
  }

  function linfit(xs, ys) {
    const n = xs.length; if (n < 2) return { a: ys[0] || 0, b: 0 };
    const mx = xs.reduce((s, x) => s + x, 0) / n, my = ys.reduce((s, y) => s + y, 0) / n;
    let sxy = 0, sxx = 0; xs.forEach((x, k) => { sxy += (x - mx) * (ys[k] - my); sxx += (x - mx) * (x - mx); });
    const b = sxx > 0 ? sxy / sxx : 0; return { a: my - b * mx, b };
  }

  // Apply estimator across the year → per-day Rf estimate, health, plus current-state summary.
  function estimate(model, days, base) {
    const series = model.exs.map(() => []);
    days.forEach(d => {
      d.ex.forEach((e, i) => {
        if (e.off || !e.n) { series[i].push({ day: d.day, off: true }); return; }
        const UAc = predictCleanUA(model, base, i, e.mc, e.mh);
        const Rf = Math.max(0, (1 / e.UA - 1 / UAc) * model.exs[i].area / 1000);
        series[i].push({ day: d.day, UA: e.UA, UAc, Rf, health: Math.min(100, 100 * e.UA / UAc), est: e.est, Tco: e.Tco, Thi: e.Thi, Tho: e.Tho, Q: e.Q, mh: e.mh });
      });
    });
    // smoothing (7-day trailing median-ish mean, skipping offline days)
    series.forEach(s => {
      s.forEach((p, k) => {
        if (p.off) return;
        const win = s.slice(Math.max(0, k - 6), k + 1).filter(q => !q.off && q.day >= lastOff(s, k));
        p.RfS = win.reduce((a, q) => a + q.Rf, 0) / win.length;
        p.healthS = win.reduce((a, q) => a + q.health, 0) / win.length;
      });
    });
    return series;
  }
  function lastOff(s, k) { for (let j = k; j >= 0; j--) if (s[j].off) return s[j].day + 1; return 0; }

  /* ------------------------------------------------------------------ *
   * Layer D — economics and cleaning optimisation
   * ------------------------------------------------------------------ */
  // Loss attribution: CIT gained if exchanger i alone were clean (network-aware).
  function attribution(model, Rf, crudeVol) {
    const base = solveTrain(model, { Rf, crudeVol });
    const clean = solveTrain(model, { Rf: [0, 0, 0, 0, 0, 0], crudeVol });
    const perEx = Rf.map((_, i) => {
      const r = Rf.slice(); r[i] = 0;
      return solveTrain(model, { Rf: r, crudeVol }).CIT - base.CIT;
    });
    return { CIT: base.CIT, cleanCIT: clean.CIT, dCIT: clean.CIT - base.CIT, perEx, mc: base.mc };
  }

  function lossPerDayForCIT(model, dCIT, mc, cleanCIT) {
    return heaterImpact(model, cleanCIT - dCIT, mc, cleanCIT).totalEur;
  }

  /*
   * Optimal cleaning cycle per exchanger.
   * Average cost over a cycle of length τ:  A(τ) = (Ceff + ∫0^τ L(s) ds) / τ
   * L(s) = € per day attributable to exchanger i when its fouling is Rf_i(s)
   * (past: from the estimated history since last cleaning; future: linear projection).
   * Ceff = cleaning cost + loss while bypassed.
   */
  function cleaningPlan(model, series, nowRf, crudeVol) {
    const o = model.o;
    const att = attribution(model, nowRf, crudeVol);
    const plans = model.exs.map((ex, i) => {
      const s = series[i];
      const since = lastOff(s, s.length - 1);
      const hist = s.filter(p => !p.off && p.day >= since);
      const age = s.length - since;
      const recent = hist.slice(-120);
      const fit = linfit(recent.map(p => p.day), recent.map(p => p.RfS));
      const rate = Math.max(0, fit.b);                                    // m²K/W per day
      const RfNow = nowRf[i];
      // loss for exchanger i at a given Rf (others at current state)
      const lossAt = Rf => { const r = nowRf.slice(); r[i] = Rf; const base = solveTrain(model, { Rf: r, crudeVol }); const r0 = r.slice(); r0[i] = 0; const c = solveTrain(model, { Rf: r0, crudeVol }); return lossPerDayForCIT(model, c.CIT - base.CIT, base.mc, att.cleanCIT); };
      const offline = model.exs.map((_, j) => j === i);
      const byp = solveTrain(model, { Rf: nowRf.map((r, j) => j === i ? 0 : r), crudeVol, offline });
      const bypassLossDay = lossPerDayForCIT(model, att.cleanCIT - byp.CIT, byp.mc, att.cleanCIT) - lossPerDayForCIT(model, att.dCIT - att.perEx[i], att.mc, att.cleanCIT);
      const Ceff = o.cleanCost + Math.max(0, bypassLossDay) * o.cleanDays;
      // cumulative past loss
      let cum = 0; hist.forEach(p => { cum += lossAt(p.RfS); });
      let best = { tau: null, avg: Infinity };
      const lossNow = lossAt(RfNow);
      for (let f = 0; f <= 540; f += 3) {
        if (f > 0) { for (let k = f - 2; k <= f; k++) cum += lossAt(RfNow + rate * k); }
        const tau = age + f;
        const avg = (Ceff + cum) / Math.max(tau, 1);
        if (avg < best.avg) best = { tau, avg, f };
      }
      // health threshold forecast
      const UAc = cleanUA(ex, att.mc, ex.hotFlow);
      const RfRed = (100 / o.healthAmber - 1) / (UAc * 1000 / ex.area);
      const RfAmb = (100 / o.healthGreen - 1) / (UAc * 1000 / ex.area);
      const daysToRed = RfNow >= RfRed ? 0 : (rate > 0 ? (RfRed - RfNow) / rate : Infinity);
      const last = hist[hist.length - 1] || {};
      return {
        id: ex.id, hot: ex.hot, i,
        health: last.healthS, Rf: RfNow, rate, rateYr: rate * 365,
        dCIT: att.perEx[i], lossDay: lossNow,
        daysToRed, RfRed, RfAmb,
        age, bypassLossDay, Ceff,
        optDays: best.f, overdue: best.f === 0 && age > 30,
        est: !!last.est,
        conf: last.est ? 'medium' : 'high',
        state: last.healthS >= o.healthGreen ? 'ok' : last.healthS >= o.healthAmber ? 'warn' : 'bad'
      };
    });
    // one-offline-at-a-time scheduling: order by recommended day, enforce spacing
    const order = plans.filter(p => p.optDays <= 365).sort((a, b) => a.optDays - b.optDays);
    let lastEnd = -Infinity;
    order.forEach(p => { let d = Math.max(p.optDays, lastEnd + 1); p.schedDay = d; lastEnd = d + o.cleanDays; });
    plans.forEach(p => { if (p.schedDay == null) p.schedDay = null; });
    return { plans, att };
  }

  /* ------------------------------------------------------------------ *
   * Root-cause hints (diagnostic, rule-based — not a trained model)
   * ------------------------------------------------------------------ */
  function diagnose(days, series) {
    const recent = days.slice(-INJECT_DAYS);
    const avg = (arr, f) => arr.reduce((s, x) => s + f(x), 0) / (arr.length || 1);
    const hints = [];
    const saltNow = avg(recent, d => d.salt);
    const afNow = avg(recent, d => d.antifoulant);
    const blendNow = avg(recent, d => d.blend);
    // Did each exchanger foul significantly faster than its normal rate over the last two weeks?
    // ΔRf across the window vs expected design growth, tested against that exchanger's own day-to-day noise.
    const accel = series.map((s, i) => {
      const pts = s.filter(p => !p.off);
      const win = pts.filter(p => p.day >= HISTORY_DAYS - INJECT_DAYS);
      const before = pts.filter(p => p.day >= HISTORY_DAYS - INJECT_DAYS - 45 && p.day < HISTORY_DAYS - INJECT_DAYS);
      if (win.length < 6 || before.length < 10) return { ratio: 1, sig: 0, flag: false };
      const m = a => a.reduce((x, p) => x + p.Rf, 0) / a.length;
      const dRf = m(win.slice(-3)) - m(before.slice(-3));
      const exp = EXCHANGERS[i].foulYr / 365 * (INJECT_DAYS + 1);
      const f = linfit(before.map(p => p.day), before.map(p => p.Rf));
      const res = before.map(p => p.Rf - (f.a + f.b * p.day));
      const sd = Math.sqrt(res.reduce((x, r) => x + r * r, 0) / res.length) || 1e-9;
      const sig = (dRf - exp) / (sd * Math.sqrt(2 / 3));
      return { ratio: dRf / exp, sig, flag: sig > 6 && dRf > 3 * exp };
    });
    const flags = accel.map(a => a.flag);
    const nHot = flags.slice(3).filter(Boolean).length, nCold = flags.slice(0, 3).filter(Boolean).length;
    const topI = accel.map((a, i) => [a.sig, i]).sort((x, y) => y[0] - x[0])[0][1];
    if (saltNow > 5) hints.push({ key: 'desalter', text: 'Desalter outlet salt is high. Salt and solids carry-over foul the whole train and also raise overhead chloride corrosion risk. Check desalter wash water, mixing valve ΔP and interface level.' });
    if (afNow < 5) hints.push({ key: 'antifoulant', text: 'Antifoulant injection is near zero. The hot end (E-104 to E-106) is most affected. Check the dosing pump and injection point.' });
    const utilityCause = saltNow > 5 || afNow < 5;
    if (nHot + nCold === 1 && flags[topI] && !utilityCause) hints.push({ key: 'local', ex: topI, text: `${EXCHANGERS[topI].id} is fouling much faster than the rest of the train. A local cause is likely: low crude velocity (bypass valve passing), a hot-side problem, or an instrument fault. Verify its temperature transmitters before planning a cleaning.` });
    else if (nHot >= 2 && nCold === 0 && saltNow <= 5) hints.push({ key: 'hotend', text: 'Fouling is accelerating mainly at the hot end. This pattern fits asphaltene or organic deposition from crude instability or high film temperature.' });
    else if (nHot >= 2 && nCold >= 1 && saltNow <= 5 && afNow >= 5) hints.push({ key: 'whole', text: 'Fouling is accelerating across the whole train. Check desalter performance and inorganic solids first.' });
    if (blendNow > 1.5) hints.push({ key: 'blend', text: 'The current crude blend has a high fouling index. Review blend compatibility before the next crude switch.' });
    if (!hints.length) hints.push({ key: 'normal', text: 'Fouling rates are within the normal range for this crude slate.' });
    return { hints, saltNow, afNow, blendNow, accel };
  }

  /* ------------------------------------------------------------------ *
   * Validation against synthetic truth
   * ------------------------------------------------------------------ */
  function validate(series, hist) {
    return series.map((s, i) => {
      const pairs = s.filter(p => !p.off && p.day >= TRAIN_DAYS).map(p => [p.RfS, hist.truthDaily[p.day].Rf[i]]);
      const n = pairs.length;
      const mae = pairs.reduce((a, [e, t]) => a + Math.abs(e - t), 0) / n;
      const mt = pairs.reduce((a, [, t]) => a + t, 0) / n;
      const ssr = pairs.reduce((a, [e, t]) => a + (e - t) ** 2, 0), sst = pairs.reduce((a, [, t]) => a + (t - mt) ** 2, 0);
      const maxT = Math.max(...pairs.map(p => p[1]));
      return { id: EXCHANGERS[i].id, n, mae, r2: 1 - ssr / sst, maxTrue: maxT, maePct: 100 * mae / maxT };
    });
  }

  /* ------------------------------------------------------------------ *
   * One-call pipeline used by the dashboard
   * ------------------------------------------------------------------ */
  function run(opts) {
    opts = opts || {};
    const model = buildModel(opts.params);
    const hist = generateHistory(model, { seed: opts.seed, extraMult: opts.extraMult, endDate: opts.endDate, injected: opts.injected });
    const days = measuredDaily(model, hist);
    const base = trainBaselines(model, days);
    const series = estimate(model, days, base);
    const nowRf = series.map(s => { const p = s[s.length - 1]; return p.off ? 0 : p.RfS; });
    const feedNow = model.o.crudeVol;   // evaluate today's fouling at the live feed target so numbers match the dashboard
    const plan = cleaningPlan(model, series, nowRf, feedNow);
    const heater = heaterImpact(model, plan.att.CIT, plan.att.mc, plan.att.cleanCIT);
    const diag = diagnose(days, series);
    return { model, hist, days, base, series, nowRf, plan, heater, diag, feedNow };
  }

  return {
    DEFAULTS, EXCHANGERS, EVENTS, HISTORY_DAYS, TRAIN_DAYS, INJECT_DAYS,
    cpCrude, cragoe, crudeMass, expectedFiringPct, ARAB_MEDIUM_SG, buildModel, solveTrain, foulingRate, heaterImpact,
    generateHistory, historyToCSV, tagNames, measuredDaily, trainBaselines, estimate,
    attribution, cleaningPlan, diagnose, validate, run
  };
});
