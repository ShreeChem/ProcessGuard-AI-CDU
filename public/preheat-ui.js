/*
 * ProcessGuard V17 — Preheat Health user interface
 * Loaded after app.js. Uses app.js globals: state, $, $$, render, showView, toast, baseline.
 * All numbers come from preheat-engine.js (synthetic demonstration data).
 */
(function () {
  'use strict';
  const PE = window.PreheatEngine;

  /* ---------------------------------------------------------------- *
   * State
   * ---------------------------------------------------------------- */
  const PG = window.PG = {
    ready: false,
    base: null,        // engine result, normal operation (today)
    inj: null,         // engine result with injected cause (last 14 days)
    injCfg: null,      // { cause, ex, severity }
    params: Object.assign({}, PE.DEFAULTS),
    selectedEx: 5,     // history chart selection
    drawerEx: null,
    lastLang: null,
    lastKey: ''
  };

  const today = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
  const de = () => state.language === 'DE';
  const L = (en, deTxt) => (de() ? deTxt : en);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const nf = (v, d) => (v == null || !isFinite(v) ? '–' : v.toLocaleString(de() ? 'de-DE' : 'en-GB', { minimumFractionDigits: d, maximumFractionDigits: d }));
  const eur = v => `€ ${nf(v, 0)}`;
  const fmtDate = d => new Intl.DateTimeFormat(de() ? 'de-DE' : 'en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).format(d);
  const addDays = (d, n) => new Date(d.getTime() + n * 86400000);

  /* ---------------------------------------------------------------- *
   * Engine runs
   * ---------------------------------------------------------------- */
  function computeRun(injected) {
    const r = PE.run({ params: PG.params, injected, endDate: today() });
    r.CIT = r.plan.att.CIT;
    r.cleanCIT = r.plan.att.cleanCIT;
    return r;
  }

  // Recompute economics only (fast) after an assumption changes.
  function recomputeEconomics(r) {
    if (!r) return;
    Object.assign(r.model.o, PG.params);
    r.plan = PE.cleaningPlan(r.model, r.series, r.nowRf, r.feedNow);
    r.heater = PE.heaterImpact(r.model, r.plan.att.CIT, r.plan.att.mc, r.plan.att.cleanCIT);
  }

  function init() {
    PG.base = computeRun(null);
    PG.ready = true;
    renderPreheatView(true);
    render();
  }

  // Called by app.js inject() for the preheat scenario.
  const DEFAULT_TITLE = 'Heat-recovery degradation / fouling';
  PG.startInjection = function (cfg) {
    PG.injCfg = cfg;
    try { scenarioCfg.preheat.title = CAUSES[cfg.cause].en + (cfg.cause === 'local' ? ` · ${exName(cfg.ex)}` : ''); } catch (e) { /* optional */ }
    PG.inj = computeRun({ cause: cfg.cause, ex: cfg.ex, severity: cfg.severity });
    renderPreheatView(true);
  };
  PG.clearInjection = function () {
    PG.injCfg = null;
    try { scenarioCfg.preheat.title = DEFAULT_TITLE; } catch (e) { /* optional */ }
    PG.inj = null;
    renderPreheatView(true);
  };

  // Current displayed result (injected result once a preheat scenario is running).
  const cur = () => (PG.inj && state.scenario && state.scenario.type === 'preheat' ? PG.inj : PG.base);
  PG.current = cur;

  // Ramp 0..1 of the live scenario (V16 scenarios ramp over 12 sim-minutes).
  PG.ramp = function () {
    if (!state.scenario || state.scenario.type !== 'preheat' || !PG.inj) return 0;
    const t = Math.max(0, (state.simSeconds - state.scenario.started) / 60);
    return Math.min(1, t / 12);
  };

  // CIT drop of the injected case versus today (°C), for scenarioTargets.
  PG.injDrop = () => (PG.inj && PG.base ? Math.max(0, PG.base.CIT - PG.inj.CIT) : 0);

  // Live per-exchanger health for the PFD rings (interpolated during the ramp).
  PG.liveHealth = function () {
    if (!PG.base) return null;
    const x = PG.ramp();
    return PG.base.plan.plans.map((p, i) => {
      const hi = PG.inj ? PG.inj.plan.plans[i].health : p.health;
      return p.health + (hi - p.health) * x;
    });
  };

  PG.stateOf = h => (h >= PG.params.healthGreen ? 'ok' : h >= PG.params.healthAmber ? 'warn' : 'bad');

  /* ---------------------------------------------------------------- *
   * Physics twin for F-101 expected firing (same as heater_model.py)
   * ---------------------------------------------------------------- */
  PG.expectedFiring = (feed, preheat, furnaceSP) => PE.expectedFiringPct(PG.params, feed, preheat, furnaceSP).firing;
  PG.impliedDuty = (feed, preheat, furnaceSP) => PE.expectedFiringPct(PG.params, feed, preheat, furnaceSP).dutyMW;

  /* ---------------------------------------------------------------- *
   * Text helpers
   * ---------------------------------------------------------------- */
  const CAUSES = {
    desalter: { en: 'Desalter upset (salt / solids carry-over)', de: 'Entsalzer-Störung (Salz-/Feststoffverschleppung)' },
    antifoulant: { en: 'Antifoulant injection pump stopped', de: 'Antifoulant-Dosierpumpe ausgefallen' },
    blend: { en: 'Unstable crude blend (asphaltene fouling)', de: 'Instabile Rohölmischung (Asphalten-Fouling)' },
    local: { en: 'Single exchanger (local cause)', de: 'Einzelner Wärmetauscher (lokale Ursache)' }
  };
  PG.causeText = c => (CAUSES[c] ? L(CAUSES[c].en, CAUSES[c].de) : '');

  function stateLabel(s) {
    return s === 'ok' ? L('Good', 'Gut') : s === 'warn' ? L('Watch', 'Beobachten') : L('Poor', 'Schlecht');
  }
  function pill(h) {
    const s = PG.stateOf(h);
    return `<span class="ph-pill ph-${s}">${nf(h, 0)} %</span>`;
  }
  function cleaningText(p) {
    if (p.schedDay == null) return L('Not needed within 12 months', 'In 12 Monaten nicht nötig');
    const d = addDays(today(), p.schedDay);
    if (p.optDays === 0) return `${L('Next opportunity', 'Nächste Gelegenheit')} · ${fmtDate(d)}`;
    return `${fmtDate(d)} · ${L('in', 'in')} ${p.schedDay} ${L('days', 'Tagen')}`;
  }
  function redText(p) {
    if (p.daysToRed === 0) return L('Now', 'Jetzt');
    if (!isFinite(p.daysToRed) || p.daysToRed > 365) return L('> 12 months', '> 12 Monate');
    return `${Math.round(p.daysToRed)} ${L('days', 'Tage')}`;
  }
  const exName = i => PE.EXCHANGERS[i].id;
  const sevText = v => ({ mild: L('mild', 'leicht'), medium: L('medium', 'mittel'), strong: L('strong', 'stark') }[v] || v);
  const hotText = h => (h === 'Residue' ? L('Residue', 'Rückstand') : h);

  /* ---------------------------------------------------------------- *
   * Train schematic (shared by view)
   * ---------------------------------------------------------------- */
  function trainSvg(r, health) {
    const ex = r.plan.att;
    const pos = [0, 1, 2, 3, 4, 5].map(i => 96 + i * 104);
    const temps = PE.EXCHANGERS.map((e, i) => r.series[i][r.series[i].length - 1].Tco);
    const hot = PE.EXCHANGERS.map(e => e.hot);
    let s = `<svg class="ph-train" viewBox="0 0 800 190" role="img" aria-label="${esc(L('Preheat train E-101 to E-106 with health state per exchanger', 'Vorwärmzug E-101 bis E-106 mit Zustand je Wärmetauscher'))}">`;
    s += `<defs><marker id="phArrC" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0L10,5L0,10z" fill="#15985f"/></marker><marker id="phArrH" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0L10,5L0,10z" fill="#ef6b24"/></marker></defs>`;
    s += `<rect x="6" y="92" width="58" height="36" rx="10" class="ph-vessel"/><text x="35" y="108" text-anchor="middle" class="ph-t-s">${L('Desalter', 'Entsalzer')}</text><text x="35" y="121" text-anchor="middle" class="ph-t-m">${nf(PG.params.desalterT, 0)} °C</text>`;
    s += `<line x1="64" y1="110" x2="722" y2="110" stroke="#15985f" stroke-width="3" marker-end="url(#phArrC)"/>`;
    pos.forEach((x, i) => {
      const h = health[i], st = PG.stateOf(h);
      s += `<g class="ph-hx-g" data-hx="${i}" tabindex="0" role="button" aria-label="${exName(i)} ${nf(h, 0)} %">`;
      s += `<line x1="${x}" y1="36" x2="${x}" y2="88" stroke="#ef6b24" stroke-width="2" marker-end="url(#phArrH)"/><text x="${x}" y="28" text-anchor="middle" class="ph-t-hot">${esc(hotText(hot[i]))}</text>`;
      s += `<circle cx="${x}" cy="110" r="21" class="ph-hx ph-ring-${st}"/><path d="M${x - 11} 110l5-9 6 18 6-18 5 9" class="ph-hx-zig"/>`;
      s += `<text x="${x}" y="150" text-anchor="middle" class="ph-t-tag">${exName(i)}</text><text x="${x}" y="165" text-anchor="middle" class="ph-t-m">${nf(temps[i], 0)} °C · ${nf(h, 0)} %</text></g>`;
    });
    s += `<rect x="724" y="86" width="68" height="48" rx="6" class="ph-heater"/><text x="758" y="106" text-anchor="middle" class="ph-t-s">F-101</text><text x="758" y="121" text-anchor="middle" class="ph-t-m">CIT ${nf(ex.CIT, 1)}</text>`;
    s += `</svg>`;
    return s;
  }

  /* ---------------------------------------------------------------- *
   * History chart
   * ---------------------------------------------------------------- */
  function historyChart(r, sel) {
    const W = 760, H = 240, pl = 40, pr = 12, pt = 22, pb = 28;
    const days = PE.HISTORY_DAYS;
    const X = d => pl + (W - pl - pr) * d / (days - 1);
    const Y = h => pt + (H - pt - pb) * (100 - h) / 50;          // 50 … 100 %
    const g = PG.params.healthGreen, a = PG.params.healthAmber;
    let s = `<svg class="ph-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(L('Health history over 12 months', 'Zustandsverlauf über 12 Monate'))}">`;
    s += `<rect x="${pl}" y="${Y(100)}" width="${W - pl - pr}" height="${Y(g) - Y(100)}" class="ph-band-ok"/>`;
    s += `<rect x="${pl}" y="${Y(g)}" width="${W - pl - pr}" height="${Y(a) - Y(g)}" class="ph-band-warn"/>`;
    s += `<rect x="${pl}" y="${Y(a)}" width="${W - pl - pr}" height="${Y(50) - Y(a)}" class="ph-band-bad"/>`;
    [50, 60, 70, 80, 90, 100].forEach(h => { s += `<line x1="${pl}" x2="${W - pr}" y1="${Y(h)}" y2="${Y(h)}" class="ph-grid"/><text x="${pl - 6}" y="${Y(h) + 3}" text-anchor="end" class="ph-axis">${h}</text>`; });
    // month ticks
    const start = r.hist.start;
    for (let m = 0; m < 13; m++) {
      const d = new Date(start.getFullYear(), start.getMonth() + m, 1);
      const dd = (d - start) / 86400000;
      if (dd < 0 || dd > days - 1) continue;
      s += `<line x1="${X(dd)}" x2="${X(dd)}" y1="${H - pb}" y2="${H - pb + 4}" class="ph-grid"/><text x="${X(dd)}" y="${H - pb + 16}" text-anchor="middle" class="ph-axis">${new Intl.DateTimeFormat(de() ? 'de-DE' : 'en-GB', { month: 'short' }).format(d)}</text>`;
    }
    // events
    r.hist.events.forEach(e => {
      if (e.day === 0) return;
      s += `<line x1="${X(e.day)}" x2="${X(e.day)}" y1="${pt}" y2="${H - pb}" class="ph-event"/>`;
    });
    if (PG.inj && r === PG.inj) s += `<rect x="${X(days - PE.INJECT_DAYS)}" y="${pt}" width="${X(days - 1) - X(days - PE.INJECT_DAYS)}" height="${H - pt - pb}" class="ph-inj-band"/>`;
    const path = i => {
      let d = '', pen = false;
      r.series[i].forEach(p => {
        if (p.off || p.healthS == null) { pen = false; return; }
        const hv = Math.max(50, Math.min(100, p.healthS));
        d += `${pen ? 'L' : 'M'}${X(p.day).toFixed(1)} ${Y(hv).toFixed(1)}`; pen = true;
      });
      return d;
    };
    for (let i = 0; i < 6; i++) if (i !== sel) s += `<path d="${path(i)}" class="ph-line-bg"/>`;
    s += `<path d="${path(sel)}" class="ph-line"/>`;
    const last = r.series[sel][r.series[sel].length - 1];
    if (!last.off) s += `<circle cx="${X(last.day)}" cy="${Y(Math.max(50, last.healthS))}" r="4" class="ph-dot"/>`;
    s += `<text x="${pl - 30}" y="12" class="ph-axis">${L('Health %', 'Zustand %')}</text>`;
    s += `</svg>`;
    return s;
  }

  /* ---------------------------------------------------------------- *
   * View
   * ---------------------------------------------------------------- */
  function renderPreheatView(force) {
    const el = $('#preheatPanel');
    if (!el || !PG.ready) return;
    const r = cur();
    const key = [state.language, !!(PG.inj && state.scenario && state.scenario.type === 'preheat'), JSON.stringify(PG.params), PG.selectedEx].join('|');
    if (!force && key === PG.lastKey) return;
    PG.lastKey = key;
    const o = PG.params;
    const plans = r.plan.plans, att = r.plan.att, H = r.heater, diag = r.diag;
    const worst = plans.slice().sort((a, b) => a.health - b.health)[0];
    const injOn = !!(PG.inj && r === PG.inj);
    const val = PE.validate(r.series, r.hist);

    const tiles = `
      <div class="ph-tiles">
        <div class="ph-tile"><span>${L('Preheat outlet (CIT)', 'Vorwärm-Austritt (CIT)')}</span><strong>${nf(att.CIT, 1)} °C</strong><small>${L('Clean train', 'Sauberer Zug')}: ${nf(att.cleanCIT, 1)} °C · <b>−${nf(att.dCIT, 1)} °C</b></small></div>
        <div class="ph-tile"><span>${L('Extra F-101 firing', 'Mehrfeuerung F-101')}</span><strong>+${nf(H.dFired, 1)} MW</strong><small>${L('Firing', 'Feuerung')} ${nf(H.firing, 1)} % (${L('clean', 'sauber')} ${nf(H.cleanFiring, 1)} %)</small></div>
        <div class="ph-tile"><span>${L('Cost of fouling', 'Kosten durch Fouling')}</span><strong>${eur(H.totalEur)} / ${L('day', 'Tag')}</strong><small>${nf(H.co2t, 1)} t CO₂ / ${L('day', 'Tag')} · ${L('fuel + CO₂', 'Brennstoff + CO₂')}</small></div>
        <div class="ph-tile"><span>${L('Heater margin', 'Ofenreserve')}</span><strong>${nf(H.marginPct, 1)} %-pt</strong><small>${L('to assumed practical limit of', 'bis zur angenommenen Grenze von')} ${nf(o.practicalMaxFiring, 0)} %${H.feedAtRisk > 0 ? ` · <b>${nf(H.feedAtRisk, 0)} m³/h ${L('feed at risk', 'Durchsatz gefährdet')}</b>` : ''}</small></div>
      </div>`;

    const injBanner = injOn ? `<div class="ph-banner">${L('Injected scenario', 'Eingespeistes Szenario')}: <b>${esc(PG.causeText(PG.injCfg.cause))}${PG.injCfg.cause === 'local' ? ` · ${exName(PG.injCfg.ex)}` : ''}</b> · ${L('severity', 'Schwere')} ${esc(sevText(PG.injCfg.severity))} · ${L('acting over the last 14 days of the history. The live PFD replays it time-compressed.', 'wirkt über die letzten 14 Tage des Verlaufs. Das Live-PFD spielt es zeitgerafft ab.')}</div>` : '';

    const table = `
      <table class="data-table ph-table">
        <tr><th>${L('Exchanger', 'Wärmetauscher')}</th><th>${L('Hot stream', 'Heißer Strom')}</th><th>${L('Health', 'Zustand')}</th><th>Rf (m²K/W)</th><th>${L('Fouling rate / yr', 'Foulingrate / Jahr')}</th><th>${L('CIT loss', 'CIT-Verlust')}</th><th>${L('Cost / day', 'Kosten / Tag')}</th><th>${L('Red limit in', 'Rote Grenze in')}</th><th>${L('Suggested cleaning', 'Empfohlene Reinigung')}</th><th>${L('Confidence', 'Vertrauen')}</th></tr>
        ${plans.map(p => `<tr class="ph-row" data-hx="${p.i}" tabindex="0"><td><b>${p.id}</b></td><td>${esc(hotText(p.hot))}</td><td>${pill(p.health)}</td><td class="ph-num">${p.Rf.toExponential(2)}</td><td class="ph-num">${p.rateYr < 1e-5 ? '< 1e-5' : p.rateYr.toExponential(1)}</td><td class="ph-num">${nf(p.dCIT, 1)} °C</td><td class="ph-num">${eur(p.lossDay)}</td><td>${redText(p)}</td><td>${cleaningText(p)}</td><td>${p.conf === 'high' ? L('High', 'Hoch') : L('Medium · 1 temperature estimated', 'Mittel · 1 Temperatur geschätzt')}</td></tr>`).join('')}
        <tr class="ph-total"><td colspan="5"><b>${L('Train total', 'Zug gesamt')}</b></td><td class="ph-num"><b>${nf(att.dCIT, 1)} °C</b></td><td class="ph-num"><b>${eur(H.totalEur)}</b></td><td colspan="3">${L('Per-exchanger losses are network-aware and do not add up exactly to the train total.', 'Verluste je Tauscher sind netzwerkbezogen und addieren sich nicht exakt zur Summe.')}</td></tr>
      </table>`;

    const plan = plans.filter(p => p.schedDay != null).sort((a, b) => a.schedDay - b.schedDay);
    const planCard = `
      <div class="workspace-card">
        <h3>${L('Cleaning plan', 'Reinigungsplan')}</h3>
        <p>${L('Cleans each exchanger when the average cost per day over its cycle (cleaning cost + lost heat) is lowest. Only one exchanger is bypassed at a time.', 'Reinigt jeden Tauscher, wenn die mittleren Kosten pro Tag über den Zyklus (Reinigung + Wärmeverlust) minimal sind. Es wird immer nur ein Tauscher umfahren.')}</p>
        ${plan.length ? `<ol class="ph-plan">${plan.map(p => `<li><b>${p.id}</b> · ${cleaningText(p)}<br><small>${L('Saves about', 'Spart etwa')} ${eur(p.lossDay)} / ${L('day', 'Tag')} · ${L('bypass cost', 'Bypass-Kosten')} ${eur(p.Ceff - o.cleanCost)} + ${L('cleaning', 'Reinigung')} ${eur(o.cleanCost)}</small></li>`).join('')}</ol>` : `<p><b>${L('No cleaning needed within 12 months.', 'Keine Reinigung in den nächsten 12 Monaten nötig.')}</b></p>`}
      </div>`;

    const hintText = h => {
      const T = {
        desalter: ['Desalter outlet salt is high. Salt and solids carry-over foul the whole train and also raise overhead chloride corrosion risk. Check desalter wash water, mixing valve ΔP and interface level.', 'Salzgehalt am Entsalzer-Austritt ist hoch. Salz- und Feststoffverschleppung verschmutzt den ganzen Zug und erhöht das Chlorid-Korrosionsrisiko im Kopfsystem. Waschwasser, Mischventil-ΔP und Trennschicht prüfen.'],
        antifoulant: ['Antifoulant injection is near zero. The hot end (E-104 to E-106) is most affected. Check the dosing pump and injection point.', 'Antifoulant-Dosierung nahe null. Das heiße Ende (E-104 bis E-106) ist am stärksten betroffen. Dosierpumpe und Einspritzstelle prüfen.'],
        hotend: ['Fouling is accelerating mainly at the hot end. This pattern fits asphaltene or organic deposition from crude instability or high film temperature.', 'Das Fouling beschleunigt vor allem am heißen Ende. Das passt zu Asphalten- bzw. organischer Ablagerung durch instabiles Rohöl oder hohe Filmtemperatur.'],
        whole: ['Fouling is accelerating across the whole train. Check desalter performance and inorganic solids first.', 'Das Fouling beschleunigt im ganzen Zug. Zuerst Entsalzerleistung und anorganische Feststoffe prüfen.'],
        blend: ['The current crude blend has a high fouling index. Review blend compatibility before the next crude switch.', 'Die aktuelle Rohölmischung hat einen hohen Fouling-Index. Mischungsverträglichkeit vor dem nächsten Rohölwechsel prüfen.'],
        normal: ['Fouling rates are within the normal range for this crude slate.', 'Die Foulingraten liegen im normalen Bereich für dieses Rohöl.']
      };
      if (h.key === 'local') return L(`${exName(h.ex)} is fouling much faster than the rest of the train. A local cause is likely: low crude velocity (bypass valve passing), a hot-side problem, or an instrument fault. Verify its temperature transmitters before planning a cleaning.`, `${exName(h.ex)} verschmutzt deutlich schneller als der Rest des Zugs. Wahrscheinlich eine lokale Ursache: geringe Rohölgeschwindigkeit (Bypassventil undicht), Problem auf der heißen Seite oder Messfehler. Vor einer Reinigung die Temperaturtransmitter prüfen.`);
      return L(T[h.key][0], T[h.key][1]);
    };
    const causeCard = `
      <div class="workspace-card">
        <h3>${L('Root-cause hints', 'Hinweise zur Ursache')}</h3>
        <ul>${diag.hints.map(h => `<li>${hintText(h)}</li>`).join('')}</ul>
        <p class="ph-small">${L('Drivers, last 14 days', 'Einflussgrößen, letzte 14 Tage')}: ${L('desalter salt', 'Entsalzer-Salz')} <b>${nf(diag.saltNow, 1)} PTB</b> · ${L('antifoulant', 'Antifoulant')} <b>${nf(diag.afNow, 1)} L/h</b> · ${L('blend fouling index', 'Mischungs-Fouling-Index')} <b>${nf(diag.blendNow, 2)}</b></p>
        <p class="ph-small">${L('Rule-based hints from the driver tags and the pattern of which exchangers accelerated. Not a confirmed root cause.', 'Regelbasierte Hinweise aus den Einflussgrößen und dem Muster der beschleunigten Tauscher. Keine bestätigte Ursache.')}</p>
      </div>`;

    const opts = PE.EXCHANGERS.map((e, i) => `<option value="${i}" ${i === PG.selectedEx ? 'selected' : ''}>${e.id}</option>`).join('');
    const histCard = `
      <div class="workspace-card wide">
        <div class="ph-card-head"><h3>${L('12-month health history', 'Zustandsverlauf, 12 Monate')}</h3><label class="ph-inline">${L('Highlight', 'Hervorheben')} <select id="phSelEx">${opts}</select></label></div>
        <div class="ph-chart-wrap">${historyChart(r, PG.selectedEx)}</div>
        <ul class="ph-events">${r.hist.events.map(e => `<li><b>${fmtDate(e.date)}</b> ${esc(eventText(e))}</li>`).join('')}${injOn ? `<li><b>${L('Last 14 days', 'Letzte 14 Tage')}</b> ${esc(PG.causeText(PG.injCfg.cause))} (${L('injected', 'eingespeist')})</li>` : ''}</ul>
      </div>`;

    const field = (id, label, v, step, unit) => `<label class="ph-field"><span>${label}</span><span class="ph-field-in"><input id="${id}" type="number" step="${step}" value="${v}"><em>${unit}</em></span></label>`;
    const assumptions = `
      <div class="workspace-card">
        <h3>${L('Economic assumptions (editable)', 'Wirtschaftliche Annahmen (änderbar)')}</h3>
        <div class="ph-fields">
          ${field('phFuel', L('Fuel price', 'Brennstoffpreis'), o.fuelPrice, 1, '€/MWh')}
          ${field('phCo2', L('CO₂ price', 'CO₂-Preis'), o.co2Price, 1, '€/t')}
          ${field('phCo2f', L('CO₂ factor', 'CO₂-Faktor'), o.co2Factor, 0.001, 't/MWh')}
          ${field('phClean', L('Cleaning cost', 'Reinigungskosten'), o.cleanCost, 1000, '€')}
          ${field('phCleanDays', L('Bypass time', 'Bypass-Dauer'), o.cleanDays, 1, L('days', 'Tage'))}
          ${field('phMaxFiring', L('Practical firing limit', 'Praktische Feuerungsgrenze'), o.practicalMaxFiring, 1, '%')}
        </div>
        <p class="ph-small">${L('Defaults are placeholders, not market data. Set the CO₂ price to the current EU ETS price before a presentation. The CO₂ factor is for natural gas; refinery fuel gas differs.', 'Standardwerte sind Platzhalter, keine Marktdaten. CO₂-Preis vor einer Präsentation auf den aktuellen EU-ETS-Preis setzen. Der CO₂-Faktor gilt für Erdgas; Raffineriegas weicht ab.')}</p>
        <button class="action" id="phReset">${L('Reset to defaults', 'Auf Standard zurücksetzen')}</button>
      </div>`;

    const modelCard = `
      <div class="workspace-card">
        <h3>${L('Model and validation', 'Modell und Validierung')}</h3>
        <ul>
          <li>${L('Physics: ε-NTU exchangers in series; the residue loop (E-106 → E-105) is solved iteratively.', 'Physik: ε-NTU-Tauscher in Reihe; der Rückstandskreis (E-106 → E-105) wird iterativ gelöst.')}</li>
          <li>${L('Fouling: Ebert–Panchal-type threshold model (faster at high film temperature, slower at high velocity).', 'Fouling: Schwellenmodell nach Ebert–Panchal (schneller bei hoher Filmtemperatur, langsamer bei hoher Geschwindigkeit).')}</li>
          <li>${L('Crude basis: Arab Medium, SG 0.8713, Cragoe Cp. Same heater energy balance as the F-101 model.', 'Rohölbasis: Arab Medium, SG 0,8713, Cp nach Cragoe. Gleiche Ofen-Energiebilanz wie im F-101-Modell.')}</li>
          <li>${L(`Clean-baseline model: regression per exchanger, trained on the first ${PE.TRAIN_DAYS} days after turnaround (ln UA vs crude flow, hot flow, time).`, `Sauberbasis-Modell: Regression je Tauscher, trainiert auf den ersten ${PE.TRAIN_DAYS} Tagen nach dem Stillstand (ln UA über Rohölstrom, Heißstrom, Zeit).`)}</li>
        </ul>
        <table class="data-table"><tr><th>${L('Exchanger', 'Tauscher')}</th><th>R²</th><th>${L('Mean error', 'Mittl. Fehler')}</th></tr>${val.map(v => `<tr><td>${v.id}</td><td class="ph-num">${nf(v.r2, 2)}</td><td class="ph-num">${nf(v.maePct, 1)} % ${L('of max Rf', 'vom max. Rf')}</td></tr>`).join('')}</table>
        <p class="ph-small">${L('Validation compares estimated Rf with the known synthetic truth. Errors come from unmodelled crude-property changes and a slowly drifting E-104 outlet transmitter, both included on purpose. Real plant data will be harder; this proves the method, not plant accuracy.', 'Die Validierung vergleicht geschätztes Rf mit der bekannten synthetischen Wahrheit. Fehler entstehen durch nicht modellierte Rohöleigenschaften und einen driftenden E-104-Transmitter, beides absichtlich enthalten. Echte Anlagendaten sind schwieriger; das belegt die Methode, nicht die Anlagengenauigkeit.')}</p>
      </div>`;

    el.innerHTML = `
      <div class="page-head-row">
        <div>
          <h2>${L('Preheat Health', 'Vorwärmzug-Zustand')}</h2>
          <p>${L('Hot preheat train E-101 … E-106 · synthetic 12-month historian data · clean-baseline fouling model · no DCS write-back', 'Heißer Vorwärmzug E-101 … E-106 · synthetische 12-Monats-Historiandaten · Sauberbasis-Foulingmodell · kein Schreiben ins PLS')}</p>
        </div>
        <div class="ph-head-actions"><button class="action" id="phCsv">${L('Export historian CSV', 'Historian-CSV exportieren')}</button><button class="action" data-view-link="overview">← ${L('Overview', 'Übersicht')}</button></div>
      </div>
      ${injBanner}
      ${tiles}
      <div class="workspace-card wide ph-train-card"><div class="ph-card-head"><h3>${L('Preheat train', 'Vorwärmzug')}</h3><span class="ph-small">${L('Select an exchanger for details', 'Tauscher für Details auswählen')}</span></div>${trainSvg(r, plans.map(p => p.health))}</div>
      <div class="ph-table-wrap">${table}</div>
      <div class="workspace-grid">
        ${planCard}
        ${causeCard}
        ${histCard}
        ${assumptions}
        ${modelCard}
      </div>
      <p class="ph-small ph-foot">${L('Health % = actual UA ÷ predicted clean UA at the same flows. Bands: good ≥', 'Zustand % = tatsächliches UA ÷ vorhergesagtes sauberes UA bei gleichen Strömen. Bänder: gut ≥')} ${o.healthGreen} %, ${L('watch', 'beobachten')} ${o.healthAmber}–${o.healthGreen} %, ${L('poor', 'schlecht')} < ${o.healthAmber} %. ${L('All values are synthetic demonstration data.', 'Alle Werte sind synthetische Demonstrationsdaten.')}</p>`;

    bindView(el);
  }
  PG.renderView = renderPreheatView;

  function eventText(e) {
    const T = {
      turnaround: ['Start of run: all exchangers clean after turnaround', 'Laufbeginn: alle Tauscher nach Stillstand sauber'],
      desalter: ['Desalter upset: high salt / solids carry-over', 'Entsalzer-Störung: hohe Salz-/Feststoffverschleppung'],
      antifoulant: ['Antifoulant injection pump stopped', 'Antifoulant-Dosierpumpe ausgefallen']
    };
    if (e.type === 'clean') return L(`${exName(e.ex)} cleaned (bypassed 3 days)`, `${exName(e.ex)} gereinigt (3 Tage umfahren)`);
    return L(T[e.type][0], T[e.type][1]);
  }

  function bindView(el) {
    $$('[data-view-link]', el).forEach(b => b.onclick = () => showView(b.dataset.viewLink));
    $$('[data-hx]', el).forEach(g => {
      g.onclick = () => openDrawer(+g.dataset.hx);
      g.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDrawer(+g.dataset.hx); } };
    });
    const sel = $('#phSelEx', el);
    if (sel) sel.onchange = e => { PG.selectedEx = +e.target.value; renderPreheatView(true); };
    const map = { phFuel: 'fuelPrice', phCo2: 'co2Price', phCo2f: 'co2Factor', phClean: 'cleanCost', phCleanDays: 'cleanDays', phMaxFiring: 'practicalMaxFiring' };
    Object.entries(map).forEach(([id, k]) => {
      const inp = $('#' + id, el);
      if (!inp) return;
      inp.onchange = () => {
        const v = parseFloat(inp.value);
        if (!isFinite(v) || v < 0) { inp.value = PG.params[k]; toast(L('Enter a number of zero or more', 'Bitte eine Zahl ≥ 0 eingeben')); return; }
        PG.params[k] = v;
        recomputeEconomics(PG.base); recomputeEconomics(PG.inj);
        renderPreheatView(true);
        toast(L('Economics recalculated', 'Wirtschaftlichkeit neu berechnet'));
      };
    });
    const rs = $('#phReset', el);
    if (rs) rs.onclick = () => { PG.params = Object.assign({}, PE.DEFAULTS); recomputeEconomics(PG.base); recomputeEconomics(PG.inj); renderPreheatView(true); };
    const csv = $('#phCsv', el);
    if (csv) csv.onclick = exportCsv;
  }

  function exportCsv() {
    const r = cur();
    const blob = new Blob([PE.historyToCSV(r.hist)], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `processguard_preheat_synthetic_${r.hist.end.toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast(L('Synthetic historian CSV exported (hourly, 12 months)', 'Synthetische Historian-CSV exportiert (stündlich, 12 Monate)'));
  }

  /* ---------------------------------------------------------------- *
   * Exchanger detail drawer
   * ---------------------------------------------------------------- */
  function openDrawer(i) {
    PG.drawerEx = i;
    renderDrawer();
    const d = $('#hxDrawer');
    d.hidden = false;
    $('#hxDrawerScrim').hidden = false;
    requestAnimationFrame(() => d.classList.add('open'));
    const c = $('#hxDrawerClose'); if (c) c.focus();
  }
  PG.openDrawer = openDrawer;
  function closeDrawer() {
    const d = $('#hxDrawer');
    d.classList.remove('open');
    $('#hxDrawerScrim').hidden = true;
    setTimeout(() => { d.hidden = true; }, 180);
    PG.drawerEx = null;
  }

  function renderDrawer() {
    const i = PG.drawerEx;
    if (i == null) return;
    const r = cur(), p = r.plan.plans[i], ex = PE.EXCHANGERS[i], mex = r.model.exs[i];
    const s = r.series[i], last = s[s.length - 1];
    const liveH = PG.liveHealth ? PG.liveHealth()[i] : p.health;
    const n = ex.id.replace('-', '');
    const est = i >= 4;
    const rows = [
      [L('Crude in', 'Rohöl ein'), `${nf(i === 0 ? PG.params.desalterT : r.series[i - 1][r.series[i - 1].length - 1].Tco, 1)} °C`, i === 0 ? 'TI_DESALTER_OUT' : `${PE.EXCHANGERS[i - 1].id.replace('-', '')}_TCO`, 'M'],
      [L('Crude out', 'Rohöl aus'), `${nf(last.Tco, 1)} °C`, `${n}_TCO`, 'M'],
      [L('Hot in', 'Heiß ein'), `${nf(last.Thi, 1)} °C`, i === 4 ? `E106_THO` : `${n}_THI`, i === 4 ? L('EST', 'GESCH') : 'M'],
      [L('Hot out', 'Heiß aus'), `${nf(last.Tho, 1)} °C`, i === 5 ? `${n}_THO` : `${n}_THO`, i === 5 ? L('EST', 'GESCH') : 'M'],
      [L('Hot flow', 'Heißstrom'), `${nf(last.mh, 1)} kg/s`, ex.hot === 'Residue' ? 'FI_RESIDUE_KGS' : `FI_${ex.hot.replace('-', '')}_KGS`, 'M'],
      [L('Duty', 'Leistung'), `${nf(last.Q / 1000, 2)} MW`, 'PG-CAL', 'C'],
      [L('UA actual / clean', 'UA ist / sauber'), `${nf(last.UA, 0)} / ${nf(last.UAc, 0)} kW/K`, 'PG-MDL', 'MODEL']
    ];
    const W = 360, H = 120, pl = 30, pb = 18, pt = 8;
    const X = d => pl + (W - pl - 6) * d / (PE.HISTORY_DAYS - 1), Y = h => pt + (H - pt - pb) * (100 - Math.max(50, Math.min(100, h))) / 50;
    let path = '', pen = false;
    s.forEach(q => { if (q.off || q.healthS == null) { pen = false; return; } path += `${pen ? 'L' : 'M'}${X(q.day).toFixed(1)} ${Y(q.healthS).toFixed(1)}`; pen = true; });
    const g = PG.params.healthGreen, a = PG.params.healthAmber;
    const mini = `<svg viewBox="0 0 ${W} ${H}" class="ph-mini" role="img" aria-label="${esc(L('Health history', 'Zustandsverlauf'))}"><rect x="${pl}" y="${Y(100)}" width="${W - pl - 6}" height="${Y(g) - Y(100)}" class="ph-band-ok"/><rect x="${pl}" y="${Y(g)}" width="${W - pl - 6}" height="${Y(a) - Y(g)}" class="ph-band-warn"/><rect x="${pl}" y="${Y(a)}" width="${W - pl - 6}" height="${Y(50) - Y(a)}" class="ph-band-bad"/>${[50, 70, 85, 100].map(h => `<text x="${pl - 4}" y="${Y(h) + 3}" text-anchor="end" class="ph-axis">${h}</text>`).join('')}<path d="${path}" class="ph-line"/><text x="${pl}" y="${H - 4}" class="ph-axis">${fmtDate(r.hist.start)}</text><text x="${W - 6}" y="${H - 4}" text-anchor="end" class="ph-axis">${L('today', 'heute')}</text></svg>`;
    const hotC = Math.max(last.Thi || 0, last.Tho || 0);
    const corrosion = hotC > 260 ? `<div class="ph-note"><b>${L('Corrosion link', 'Korrosionsbezug')}:</b> ${L(`The hot side runs at up to ${nf(hotC, 0)} °C, above the ~260 °C threshold where high-temperature sulfidic corrosion becomes relevant (API RP 939-C). With Arab Medium at 2.54 wt% sulfur, include this exchanger in the sulfidation inspection plan. Fouling deposits can also hide under-deposit corrosion. This is a qualitative flag, not a corrosion rate.`, `Die heiße Seite läuft mit bis zu ${nf(hotC, 0)} °C, über der Schwelle von ~260 °C, ab der Hochtemperatur-Sulfidkorrosion relevant wird (API RP 939-C). Bei Arab Medium mit 2,54 Gew.-% Schwefel diesen Tauscher in den Sulfidations-Prüfplan aufnehmen. Ablagerungen können zudem Unterbelagskorrosion verdecken. Qualitativer Hinweis, keine Korrosionsrate.`)}</div>` : `<div class="ph-note"><b>${L('Corrosion link', 'Korrosionsbezug')}:</b> ${L('Below the ~260 °C sulfidation threshold. Main corrosion link here is under-deposit corrosion if fouling persists.', 'Unter der Sulfidationsschwelle von ~260 °C. Hauptbezug ist Unterbelagskorrosion bei anhaltendem Fouling.')}</div>`;

    $('#hxDrawerOpenView').textContent = L('Open Preheat Health', 'Vorwärmzug-Zustand öffnen');
    $('#hxDrawerBody').innerHTML = `
      <div class="ph-dr-head">
        <div><span class="ph-eyebrow">${L('Preheat exchanger', 'Vorwärm-Wärmetauscher')}</span><h2>${ex.id}</h2><p>${L('Crude', 'Rohöl')} ⇄ ${esc(hotText(ex.hot))} · ${L('area', 'Fläche')} ${nf(mex.area, 0)} m²</p></div>
        <div class="ph-dr-health">${pill(liveH)}<small>${stateLabel(PG.stateOf(liveH))}</small></div>
      </div>
      <div class="ph-kv">
        <div><span>Rf</span><b>${p.Rf.toExponential(2)} m²K/W</b></div>
        <div><span>${L('Fouling rate', 'Foulingrate')}</span><b>${p.rateYr.toExponential(1)} / ${L('yr', 'Jahr')}</b></div>
        <div><span>${L('CIT loss from this unit', 'CIT-Verlust durch diesen Tauscher')}</span><b>${nf(p.dCIT, 2)} °C</b></div>
        <div><span>${L('Cost', 'Kosten')}</span><b>${eur(p.lossDay)} / ${L('day', 'Tag')}</b></div>
        <div><span>${L('Red limit in', 'Rote Grenze in')}</span><b>${redText(p)}</b></div>
        <div><span>${L('Suggested cleaning', 'Empfohlene Reinigung')}</span><b>${cleaningText(p)}</b></div>
      </div>
      <h3>${L('Live values (daily average)', 'Aktuelle Werte (Tagesmittel)')}</h3>
      <table class="data-table"><tr><th>${L('Value', 'Wert')}</th><th>${L('Current', 'Aktuell')}</th><th>Tag</th><th>${L('Source', 'Quelle')}</th></tr>${rows.map(x => `<tr><td>${x[0]}</td><td class="ph-num"><b>${x[1]}</b></td><td>${x[2]}</td><td>${x[3]}</td></tr>`).join('')}</table>
      ${est ? `<p class="ph-small">${L('EST: the residue temperature between E-106 and E-105 has no transmitter in this design. It is calculated from the crude-side energy balance, so confidence is medium.', 'GESCH: Die Rückstandstemperatur zwischen E-106 und E-105 hat hier keinen Transmitter. Sie wird aus der rohölseitigen Energiebilanz berechnet; Vertrauen daher mittel.')}</p>` : ''}
      <h3>${L('Health, 12 months', 'Zustand, 12 Monate')}</h3>
      ${mini}
      ${corrosion}
      <p class="ph-small">${L('In a plant, these tags would be read read-only from the historian (e.g. PI or PHD) every 1–15 minutes. Nothing is written back to the DCS.', 'In einer Anlage würden diese Tags nur lesend alle 1–15 Minuten aus dem Historian (z. B. PI oder PHD) gelesen. Es wird nichts ins PLS zurückgeschrieben.')}</p>`;
  }

  /* ---------------------------------------------------------------- *
   * PFD rings (called from app.js renderPfd)
   * ---------------------------------------------------------------- */
  PG.renderPfdRings = function () {
    const hs = PG.liveHealth();
    if (!hs) return;
    hs.forEach((h, i) => {
      const g = document.querySelector(`#cduPfd [data-hx="${i}"]`);
      if (!g) return;
      const c = g.querySelector('circle');
      c.setAttribute('class', `hx-ring hx-${PG.stateOf(h)}`);
      g.setAttribute('aria-label', `${exName(i)} ${Math.round(h)} %`);
      const t = g.querySelector('title');
      if (t) t.textContent = `${exName(i)} · ${L('health', 'Zustand')} ${Math.round(h)} % · ${L('select for details', 'für Details auswählen')}`;
    });
    if (PG.drawerEx != null && state.running && !state.paused) {
      const pill = document.querySelector('#hxDrawer .ph-dr-health');
      if (pill) { const h = hs[PG.drawerEx]; pill.innerHTML = `<span class="ph-pill ph-${PG.stateOf(h)}">${Math.round(h)} %</span><small>${stateLabel(PG.stateOf(h))}</small>`; }
    }
  };

  /* ---------------------------------------------------------------- *
   * Evidence / ranking / checks for the preheat scenario (used by app.js)
   * ---------------------------------------------------------------- */
  PG.evidence = function (v, residual) {
    const r = cur(), H = r.heater, x = PG.ramp();
    const hs = PG.liveHealth();
    let wi = 0; hs.forEach((h, i) => { if (h < hs[wi]) wi = i; });
    const d = r.diag;
    return [
      ['Preheat outlet (CIT)', `${v.preheat.toFixed(1)} °C`, `Below clean train by ${(PG.base.cleanCIT - v.preheat).toFixed(1)} °C`],
      ['Worst exchanger', `${exName(wi)} · ${Math.round(hs[wi])} %`, 'Largest heat-transfer loss in the train'],
      ['Firing residual', `${residual.toFixed(1)} %-pt`, 'Near zero: the extra firing is explained by the lower preheat, so the F-101 coil itself looks healthy'],
      ['Extra heater fuel', `${(PG.base.heater.dFired + (H.dFired - PG.base.heater.dFired) * x).toFixed(1)} MW`, 'Versus a clean preheat train'],
      ['Desalter outlet salt', `${(PG.base.diag.saltNow + (d.saltNow - PG.base.diag.saltNow) * x).toFixed(1)} PTB`, d.saltNow > 5 && x > 0.3 ? 'High: salt and solids carry-over' : 'Normal'],
      ['Antifoulant injection', `${(PG.base.diag.afNow + (d.afNow - PG.base.diag.afNow) * x).toFixed(1)} L/h`, d.afNow < 5 && x > 0.3 ? 'Near zero: dosing stopped' : 'Normal']
    ];
  };

  PG.ranks = function () {
    const k = PG.injCfg ? PG.injCfg.cause : 'normal';
    const ex = PG.injCfg && PG.injCfg.cause === 'local' ? exName(PG.injCfg.ex) : '';
    const T = {
      desalter: [['Desalter upset / salt & solids carry-over', 68], ['Crude blend instability', 14], ['Antifoulant dosing issue', 10], ['Temperature measurement issue', 8]],
      antifoulant: [['Antifoulant injection stopped / under-dosed', 70], ['Crude blend instability', 15], ['Desalter performance', 9], ['Temperature measurement issue', 6]],
      blend: [['Crude instability / asphaltene deposition (hot end)', 66], ['Antifoulant under-dosing', 16], ['Desalter performance', 10], ['Temperature measurement issue', 8]],
      local: [[`${ex} local cause (velocity / bypass / hot side)`, 58], [`${ex} temperature transmitter fault`, 27], ['Train-wide fouling', 15]],
      normal: [['Exchanger fouling', 70], ['Hot-side availability reduction', 20], ['Temperature measurement issue', 10]]
    };
    return T[k] || T.normal;
  };

  PG.checks = function () {
    const k = PG.injCfg ? PG.injCfg.cause : 'normal';
    const common = ['Open Preheat Health to see which exchanger is losing heat transfer.', 'Confirm F-101 firing residual is near zero (heater itself healthy).'];
    const T = {
      desalter: ['Check desalter outlet salt / BS&W, wash-water rate and mixing-valve ΔP.', 'Check overhead chloride trend (corrosion risk).'],
      antifoulant: ['Check antifoulant dosing pump status and injection rate.', 'Watch hot-end exchangers E-104 to E-106.'],
      blend: ['Review current crude blend and compatibility.', 'Watch hot-end exchangers E-104 to E-106.'],
      local: [`Verify ${PG.injCfg && PG.injCfg.cause === 'local' ? exName(PG.injCfg.ex) : 'exchanger'} temperature transmitters and bypass valve position.`],
      normal: ['Review exchanger heat-recovery performance.']
    };
    return common.concat(T[k] || T.normal);
  };


  /* ---------------------------------------------------------------- *
   * German strings for text rendered through app.js panels
   * ---------------------------------------------------------------- */
  const DE_V17 = {
    'Preheat Health': 'Vorwärmzug-Zustand',
    'Preheat cause': 'Vorwärm-Ursache',
    'Exchanger': 'Wärmetauscher',
    'Desalter upset (salt / solids carry-over)': 'Entsalzer-Störung (Salz-/Feststoffverschleppung)',
    'Antifoulant injection pump stopped': 'Antifoulant-Dosierpumpe ausgefallen',
    'Unstable crude blend (asphaltene fouling)': 'Instabile Rohölmischung (Asphalten-Fouling)',
    'Single exchanger (local cause)': 'Einzelner Wärmetauscher (lokale Ursache)',
    'Preheat outlet (CIT)': 'Vorwärm-Austritt (CIT)',
    'Below clean train by': 'Unter sauberem Zug um',
    'Worst exchanger': 'Schlechtester Wärmetauscher',
    'Largest heat-transfer loss in the train': 'Größter Wärmeübertragungsverlust im Zug',
    'Near zero: the extra firing is explained by the lower preheat, so the F-101 coil itself looks healthy': 'Nahe null: die Mehrfeuerung erklärt sich durch die geringere Vorwärmung, die F-101-Rohrschlange wirkt gesund',
    'Extra heater fuel': 'Zusätzlicher Ofenbrennstoff',
    'Versus a clean preheat train': 'Gegenüber sauberem Vorwärmzug',
    'Desalter outlet salt': 'Salz am Entsalzer-Austritt',
    'High: salt and solids carry-over': 'Hoch: Salz- und Feststoffverschleppung',
    'Antifoulant injection': 'Antifoulant-Dosierung',
    'Near zero: dosing stopped': 'Nahe null: Dosierung gestoppt',
    'Desalter upset / salt & solids carry-over': 'Entsalzer-Störung / Salz- & Feststoffverschleppung',
    'Crude blend instability': 'Instabile Rohölmischung',
    'Antifoulant dosing issue': 'Problem mit Antifoulant-Dosierung',
    'Antifoulant injection stopped / under-dosed': 'Antifoulant-Dosierung gestoppt / zu gering',
    'Desalter performance': 'Entsalzerleistung',
    'Crude instability / asphaltene deposition (hot end)': 'Rohölinstabilität / Asphaltenablagerung (heißes Ende)',
    'Antifoulant under-dosing': 'Antifoulant-Unterdosierung',
    ' local cause (velocity / bypass / hot side)': ' lokale Ursache (Geschwindigkeit / Bypass / heiße Seite)',
    ' temperature transmitter fault': ' Temperaturtransmitter-Fehler',
    'Train-wide fouling': 'Fouling im ganzen Zug',
    'Open Preheat Health to see which exchanger is losing heat transfer.': 'Vorwärmzug-Zustand öffnen, um den Tauscher mit Wärmeübertragungsverlust zu sehen.',
    'Confirm F-101 firing residual is near zero (heater itself healthy).': 'Prüfen, dass das F-101-Feuerungsresiduum nahe null ist (Ofen selbst gesund).',
    'Check desalter outlet salt / BS&W, wash-water rate and mixing-valve ΔP.': 'Salz/BS&W am Entsalzer-Austritt, Waschwassermenge und Mischventil-ΔP prüfen.',
    'Check overhead chloride trend (corrosion risk).': 'Chloridtrend im Kopfsystem prüfen (Korrosionsrisiko).',
    'Check antifoulant dosing pump status and injection rate.': 'Status der Antifoulant-Dosierpumpe und Dosierrate prüfen.',
    'Watch hot-end exchangers E-104 to E-106.': 'Tauscher am heißen Ende E-104 bis E-106 beobachten.',
    'Review current crude blend and compatibility.': 'Aktuelle Rohölmischung und Verträglichkeit prüfen.',
    'Review exchanger heat-recovery performance.': 'Wärmerückgewinnung der Tauscher prüfen.',
    'Fouling deposit ↑': 'Ablagerung ↑',
    'Exchanger UA ↓': 'Tauscher-UA ↓',
    'Preheat outlet (CIT) ↓': 'Vorwärm-Austritt (CIT) ↓',
    'Heater firing ↑ (as expected)': 'Ofenfeuerung ↑ (wie erwartet)',
    'Fuel & CO₂ ↑': 'Brennstoff & CO₂ ↑',
    'Firing residual ≈ 0 → heater healthy': 'Feuerungsresiduum ≈ 0 → Ofen gesund',
    'None expected (no DCS limit on CIT)': 'Keiner erwartet (kein PLS-Grenzwert auf CIT)',
    'Exchanger forecast': 'Wärmetauscher-Prognose',
    'Fouling rate / yr': 'Foulingrate / Jahr',
    'Red limit in': 'Rote Grenze in',
    'Cost / day': 'Kosten / Tag',
    '> 12 months': '> 12 Monate',
    'Fouling develops over days to weeks, so this forecast is in days. It is a linear trend of the last 60 days of estimated fouling.': 'Fouling entwickelt sich über Tage bis Wochen, daher ist diese Prognose in Tagen. Sie ist ein linearer Trend der letzten 60 Tage des geschätzten Foulings.',
    'Open Preheat Health →': 'Vorwärmzug-Zustand öffnen →',
    'Open full report →': 'Vollständigen Bericht öffnen →',
    ' crude outlet': ' Rohöl-Austritt',
    ' health (UA / clean UA)': ' Zustand (UA / sauberes UA)',
    'Residue between E-106 and E-105': 'Rückstand zwischen E-106 und E-105',
    'Cost of fouling': 'Kosten durch Fouling',
    'Loading preheat model…': 'Vorwärmmodell wird geladen…'
  };
  try {
    Object.assign(DE, DE_V17);
    Object.entries(DE_V17).forEach(([en, deTxt]) => { EN_FROM_DE[deTxt] = en; });
  } catch (e) { /* translator not present */ }
  /* ---------------------------------------------------------------- *
   * Hooks
   * ---------------------------------------------------------------- */
  PG.onRender = function () {
    if (!PG.ready) return;
    PG.renderPfdRings();
    if (state.selectedView === 'preheat') renderPreheatView(false);
    if (PG.lastLang !== state.language) { PG.lastLang = state.language; renderPreheatView(true); if (PG.drawerEx != null) renderDrawer(); }
  };

  let staticDone = false;
  function setupStatic() {
    if (staticDone) return; staticDone = true;
    // PFD exchangers
    $$('#cduPfd [data-hx]').forEach(g => {
      g.onclick = () => openDrawer(+g.dataset.hx);
      g.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDrawer(+g.dataset.hx); } };
    });
    $('#hxDrawerClose').onclick = closeDrawer;
    $('#hxDrawerScrim').onclick = closeDrawer;
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && PG.drawerEx != null) closeDrawer(); });
    $('#hxDrawerOpenView').onclick = () => { closeDrawer(); showView('preheat'); renderPreheatView(true); };
    // Preheat sub-options in the scenario page and quick dialog
    const toggle = (selId, boxId) => {
      const sel = $(selId), box = $(boxId);
      if (!sel || !box) return;
      const upd = () => { box.hidden = sel.value !== 'preheat'; };
      sel.addEventListener('change', upd); upd();
    };
    toggle('#scenarioSelect', '#phOptsPage');
    toggle('#quickScenario', '#phOptsDialog');
    const exToggle = (causeId, exId) => {
      const c = $(causeId), e = $(exId);
      if (!c || !e) return;
      const upd = () => { e.closest('label').hidden = c.value !== 'local'; };
      c.addEventListener('change', upd); upd();
    };
    exToggle('#phCausePage', '#phExPage');
    exToggle('#phCauseDialog', '#phExDialog');
    const nav = document.querySelector('[data-view-link="preheat"]');
    if (nav) nav.addEventListener('click', () => renderPreheatView(true));
  }

  PG.readInjectOptions = function (where) {
    const c = $(where === 'dialog' ? '#phCauseDialog' : '#phCausePage');
    const e = $(where === 'dialog' ? '#phExDialog' : '#phExPage');
    return { cause: c ? c.value : 'desalter', ex: e ? +e.value : 3 };
  };

  document.addEventListener('DOMContentLoaded', setupStatic);
  if (document.readyState !== 'loading') setupStatic();
  // Heavy first run after the first paint.
  setTimeout(init, 30);
})();
