// Self-check for the Preheat Health engine: node tools/validate-preheat.js
const PE = require('../public/preheat-engine.js');
const assert = (c, m) => { if (!c) { console.error('FAIL', m); process.exitCode = 1; } else console.log('ok  ', m); };

const m = PE.buildModel();
const clean = PE.solveTrain(m, { Rf: [0, 0, 0, 0, 0, 0] });
clean.ex.forEach((r, i) => assert(Math.abs(r.Tco - PE.EXCHANGERS[i].designOut) < 0.05, `${PE.EXCHANGERS[i].id} clean outlet matches design (${r.Tco.toFixed(2)} °C)`));
const ef = PE.expectedFiringPct(m.o, 1000, 250, 382.5);
assert(Math.abs(ef.firing - 61.70) < 0.01 && Math.abs(ef.dutyMW - 94.7) < 0.05, `expected firing matches heater_model.py (${ef.firing.toFixed(2)} %, ${ef.dutyMW.toFixed(1)} MW)`);
// energy balance closes for each exchanger
clean.ex.forEach((r, i) => {
  const qc = clean.mc * PE.cpCrude((r.Tci + r.Tco) / 2) * (r.Tco - r.Tci);
  const qh = r.mh * PE.cragoe((r.Thi + r.Tho) / 2, PE.EXCHANGERS[i].hotSG) * (r.Thi - r.Tho);
  assert(Math.abs(qc - qh) / qc < 0.01, `${PE.EXCHANGERS[i].id} energy balance closes (${(qc / 1000).toFixed(2)} MW)`);
});
const r = PE.run();
assert(Math.abs(r.plan.att.CIT - 250) < 0.5, `today's CIT ≈ 250 °C (${r.plan.att.CIT.toFixed(2)})`);
PE.validate(r.series, r.hist).forEach(v => console.log(`     ${v.id}  R² ${v.r2.toFixed(2)}  mean error ${v.maePct.toFixed(1)} % of max Rf`));
for (const cause of ['desalter', 'antifoulant', 'blend', 'local']) {
  const j = PE.run({ injected: { cause, severity: 'strong', ex: 3 } });
  const key = { desalter: 'desalter', antifoulant: 'antifoulant', blend: 'hotend', local: 'local' }[cause];
  assert(j.diag.hints.some(h => h.key === key), `injected ${cause} → hint "${key}" (CIT ${j.plan.att.CIT.toFixed(1)} °C)`);
}
assert(PE.run().diag.hints[0].key === 'normal', 'no injection → "normal"');
