// compare.js -- runs docs/app.js in Node on every tests/cases/*/config_*.json and compares all results
// exactly with the output of reference.R (R 3.5.2 for sample.kind "Rounding", R 3.6.3 for "Rejection").
// usage: node compare.js [casesDir] [--markdown]
const fs = require('fs'), path = require('path');
const GTA = require('../docs/app.js');
const casesDir = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : path.join(__dirname, 'cases');
const markdown = process.argv.includes('--markdown');

const f64 = new Float64Array(1), u64 = new BigUint64Array(f64.buffer);
/** C99 printf("%a", x) as glibc prints it (normal numbers, zero, Inf, NaN) */
function hexA(x) {
  if (x === null || x === undefined) return null;
  if (Number.isNaN(x)) return 'NaN';
  if (!isFinite(x)) return x > 0 ? 'Inf' : '-Inf';
  if (x === 0) return (Object.is(x, -0) ? '-' : '') + '0x0p+0';
  f64[0] = x;
  const b = u64[0];
  const sign = (b >> 63n) ? '-' : '';
  let e = Number((b >> 52n) & 0x7ffn);
  let m = b & ((1n << 52n) - 1n);
  if (e === 0) { // subnormal: glibc prints 0x0.xxxp-1022
    return sign + '0x0.' + m.toString(16).padStart(13, '0').replace(/0+$/, '') + 'p-1022';
  }
  e -= 1023;
  let frac = m.toString(16).padStart(13, '0').replace(/0+$/, '');
  return sign + '0x1' + (frac ? '.' + frac : '') + 'p' + (e >= 0 ? '+' : '') + e;
}
const rd = f => fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
const arr = v => v === null || v === undefined ? [] : [].concat(v);
const J = JSON.stringify;

function colClass(c) { return { factor: 'factor', integer: 'integer', double: 'numeric', logical: 'logical', character: 'character' }[c.type]; }
function colValues(c) {
  const n = c.type === 'factor' ? c.codes.length : c.v.length;
  return Array.from({ length: n }, (_, i) => c.type === 'double' ? (c.v[i] === null ? null : hexA(c.v[i])) : GTA.asChar(c, i));
}
function cmpInputDF(r, df, label, diffs) {
  if (J(arr(r.names)) !== J(df.names)) { diffs.push(`${label}: names R=${J(r.names)} JS=${J(df.names)}`); return; }
  arr(r.names).forEach((nm, j) => {
    const c = df.cols[j];
    if (arr(r.class)[j] !== colClass(c)) diffs.push(`${label}.${nm}: class R=${arr(r.class)[j]} JS=${colClass(c)}`);
    if (c.type === 'factor' && J(arr(r.levels[nm])) !== J(c.levels)) diffs.push(`${label}.${nm}: levels R=${J(r.levels[nm])} JS=${J(c.levels)}`);
    const rv = arr(r.values[nm]), jv = colValues(c);
    if (J(rv) !== J(jv)) diffs.push(`${label}.${nm}: values differ R=${J(rv).slice(0, 120)} JS=${J(jv).slice(0, 120)}`);
  });
}
function eqArr(a, b) { return J(arr(a)) === J(arr(b)); }

const results = [];
for (const cs of fs.readdirSync(casesDir).sort()) {
  const dir = path.join(casesDir, cs);
  if (!fs.statSync(dir).isDirectory()) continue;
  for (const cf of fs.readdirSync(dir).filter(f => /^config_\d+\.json$/.test(f)).sort()) {
    const cfg = JSON.parse(fs.readFileSync(path.join(dir, cf), 'utf8'));
    const j = cf.match(/\d+/)[0];
    const refs = [];
    if (cfg.samplekind === 'Rounding') refs.push({ R: '3.5.2', dir: path.join(dir, 'r352_' + j) });
    refs.push({ R: '3.6.3', dir: path.join(dir, 'r363_' + j) });
    for (const ref of refs) {
      if (!fs.existsSync(path.join(ref.dir, 'result.json')) && !fs.existsSync(path.join(ref.dir, 'inputs.json'))) continue;
      const diffs = [], checked = [];
      const rin = rd(path.join(ref.dir, 'inputs.json'));
      const rres = rd(path.join(ref.dir, 'result.json'));
      const local = p => path.join(dir, path.basename(p));
      const existing = GTA.readCsv(fs.readFileSync(local(cfg.existing)));
      const newp = GTA.readCsv(fs.readFileSync(local(cfg.new)));
      cmpInputDF(rin.existing, existing, 'existing', diffs);
      cmpInputDF(rin.new, newp, 'new', diffs);
      checked.push('read.csv');
      const sp = GTA.parseSpots(cfg.spots);
      if (!!sp.ok !== !!rin.spots_ok) diffs.push(`spots ok: R=${rin.spots_ok} JS=${sp.ok}`);
      if (sp.ok && rin.k) {
        if (!eqArr(rin.k.names, sp.k.names) || !eqArr(rin.k.values, sp.k.values.map(hexA))) diffs.push(`k differs R=${J(rin.k)} JS=${J(sp.k)}`);
      }
      checked.push('spots');
      let out = null;
      if (sp.ok) {
        out = GTA.runAll({ existing, newp, k: sp.k, pid: cfg.pid, seed: cfg.seed, sampleKind: cfg.samplekind, collation: 'locale', predictability: 0.8, rVersion: ref.R === '3.5.2' ? '3.5' : '3.6' });
        if (rres.error) {
          if (!out.error) diffs.push(`R error "${rres.error}" but JS succeeded`);
          else if (out.error.message !== rres.error) diffs.push(`error message R="${rres.error}" JS="${out.error.message}"`);
          checked.push('error');
        } else if (out.error) diffs.push(`JS error "${out.error.message}" but R succeeded`);
        const cap = rres.cap || {};
        const I = out.result ? out.result.info : null;
        if (I) {
          const cmp = (name, rv, jv) => { if (rv === undefined) return; if (J(arr(rv)) !== J(arr(jv))) diffs.push(`${name}: R=${J(rv).slice(0, 200)} JS=${J(jv).slice(0, 200)}`); else checked.push(name); };
          cmp('K', cap.K && cap.K.values, I.K.values.map(hexA));
          cmp('levels_wait', cap.levels_wait, I.levels_wait);
          cmp('initial_draw', cap.initial_draw, I.initial_draw);
          cmp('current_counts', cap.current_counts && cap.current_counts.data, Array.from(I.current_counts.data));
          cmp('new_counts', cap.new_counts_initial && cap.new_counts_initial.data, Array.from(I.new_counts_initial.data));
          cmp('non_zero_rows', cap.non_zero_rows, I.non_zero_rows);
          if (cap.trace) {
            cmp('trace_imb', cap.trace.imb, I.trace.map(t => hexA(t.imb)));
            const rc = cap.trace.counts, okc = rc.length === I.trace.length && rc.every((c, q) => J(arr(c)) === J(Array.from(I.trace[q].counts)));
            if (!okc) diffs.push('trace counts differ'); else checked.push('trace_counts');
          }
          cmp('iterations', (cap.iterations || []).map(it => [it.imb_before, it.best_imb, it.considered]), I.iterations.map(it => [hexA(it.imb_before), hexA(it.best_imb), it.considered]));
          cmp('final_counts', cap.final_counts, Array.from(I.final_counts));
          cmp('round_imb_10', cap.unique_imb, I.unique_imb.map(hexA));
          cmp('breaks', cap.breaks, I.breaks ? I.breaks.map(hexA) : undefined);
          cmp('p_y', cap.p_y, I.p_y ? I.p_y.map(hexA) : undefined);
          cmp('class_sampled', cap.class_sampled, I.class_sampled);
          cmp('sampled_index', cap.sampled_index, I.sampled_index);
          cmp('sampled_counts', cap.sampled_counts, Array.from(I.sampled_counts));
          cmp('group_sizes', cap.group_sizes, I.group_sizes);
        }
        if (rres.alloc && out.result) {
          const ra = rres.alloc, ja = out.result.alloc;
          if (!eqArr(ra.names, ja.names)) diffs.push(`alloc names R=${J(ra.names)} JS=${J(ja.names)}`);
          else if (J(ra.rows.map(r => arr(r))) !== J(ja.rows)) diffs.push(`alloc rows differ:\n   R : ${J(ra.rows).slice(0, 300)}\n   JS: ${J(ja.rows).slice(0, 300)}`);
          else checked.push('allocation');
          const rc = rres.combined, jc = out.result.combined;
          if (!eqArr(rc.names, jc.names)) diffs.push(`combined names R=${J(rc.names)} JS=${J(jc.names)}`);
          else {
            const bad = rc.names.some((nm, q) => J(arr(rc.values[nm])) !== J(jc.rows.map(r => r[q])));
            if (bad) diffs.push('combined values differ'); else checked.push('combined');
          }
          const rcsv = path.join(ref.dir, 'download.csv');
          if (fs.existsSync(rcsv)) {
            const rb = fs.readFileSync(rcsv), jb = Buffer.from(out.download, 'utf8');
            if (!rb.equals(jb)) {
              const rl = rb.toString('utf8').split('\n'), jl = out.download.split('\n'), q = rl.findIndex((l, i) => l !== jl[i]);
              diffs.push(`download.csv differs (line ${q + 1}):\n   R : ${rl[q]}\n   JS: ${jl[q]}`);
            } else checked.push('download');
          }
        }
        if (rres.rng_state) {
          if (J(arr(rres.rng_state)) !== J(out.rngState)) diffs.push('RNG state after differs'); else checked.push('RNG state');
        }
        if (rres.instrumented_identical === false) diffs.push('reference.R: instrumented run differs from the original functions');
        // Debug tab: informational (print() formatting is approximated)
        const rdbg = path.join(ref.dir, 'debug.txt');
        if (fs.existsSync(rdbg)) {
          const o = { existing, newp, k: sp.k, pid: cfg.pid, seed: cfg.seed };
          const jd = GTA.debugText(o, out).replace(/[ ]+$/gm, ''), rdx = fs.readFileSync(rdbg, 'utf8').replace(/\n$/, '').replace(/[ ]+$/gm, '');
          ref.debugSame = jd === rdx;
          if (!ref.debugSame) { const a = rdx.split('\n'), b = jd.split('\n'), q = a.findIndex((l, i) => l !== b[i]); ref.debugDiff = `line ${q + 1}: R=${J(a[q])} JS=${J(b[q])}`; }
        }
      }
      results.push({ case: cs + '/' + cf.replace('.json', ''), R: ref.R, seed: cfg.seed, kind: cfg.samplekind, pid: cfg.pid, checked, diffs,
        rerr: rres && rres.error, jerr: out && out.error ? out.error.message : null, debugSame: ref.debugSame, debugDiff: ref.debugDiff,
        warnings: rres && rres.warnings });
    }
  }
}
let fails = 0;
for (const r of results) {
  const ok = r.diffs.length === 0;
  if (!ok) fails++;
  if (!markdown) {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${r.case}  R ${r.R}  seed=${r.seed} ${r.kind}  [${r.checked.length} checks]${r.rerr ? '  (error in both: ' + r.rerr.split('\n')[0] + ')' : ''}  debug ${r.debugSame ? 'same' : 'differs'}`);
    r.diffs.forEach(d => console.log('      ' + d));
    if (!r.debugSame && r.debugDiff && process.env.SHOW_DEBUG) console.log('      debug: ' + r.debugDiff);
  }
}
if (markdown) {
  console.log('| Case / config | R | seed | sample.kind | pid | Result | Checks passed | Debug text identical |');
  console.log('|---|---|---|---|---|---|---|---|');
  for (const r of results) console.log(`| ${r.case} | ${r.R} | ${r.seed} | ${r.kind} | ${r.pid === '' ? '(none)' : r.pid} | ${r.diffs.length ? '**FAIL**' : 'PASS'}${r.rerr ? ' (same error: ' + r.rerr.split('\n')[0].replace(/\|/g, '\\|') + ')' : ''} | ${r.checked.length} | ${r.debugSame ? 'yes' : 'no'} |`);
}
console.log(`\n${results.length - fails}/${results.length} configurations identical`);
process.exitCode = fails ? 1 : 0;
