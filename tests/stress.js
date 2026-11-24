// stress.js -- compares app.js with stress.R output (many seeds per case)
// usage: node stress.js <r.json> <Rounding|Rejection>
const fs = require('fs'), path = require('path'), GTA = require('../docs/app.js');
const R = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')), kind = process.argv[3] || 'Rounding';
const cache = {};
let ok = 0, bad = 0;
for (const r of R) {
  const dir = path.join(__dirname, 'cases', r.case);
  if (!cache[r.case]) {
    const cf = JSON.parse(fs.readFileSync(path.join(dir, 'config_01.json'), 'utf8'));
    cache[r.case] = { ex: GTA.readCsv(fs.readFileSync(path.join(dir, 'existing.csv'))), nw: GTA.readCsv(fs.readFileSync(path.join(dir, 'new.csv'))), k: GTA.parseSpots(cf.spots).k, pid: cf.pid };
  }
  const c = cache[r.case];
  const o = GTA.runAll({ existing: c.ex, newp: c.nw, k: c.k, pid: c.pid, seed: r.seed, sampleKind: kind, rVersion: kind === 'Rejection' ? '3.6' : '3.5' });
  const al = o.error ? 'ERROR ' + o.error.message : o.result.alloc.rows.map(row => row.map(v => v === null ? 'NA' : v).join(',')).join(';');
  const st = o.rngState; let cs = 0; st.forEach((v, i) => { cs += v * (i + 1); });
  if (al === r.alloc && cs === r.rng) ok++; else { bad++; if (bad <= 5) console.log('DIFF', r.case, r.seed, '\n R:', r.alloc.slice(0, 150), '\n J:', al.slice(0, 150), r.rng, cs); }
}
console.log(`stress ${kind}: ${ok}/${ok + bad} identical`);
process.exitCode = bad ? 1 : 0;
