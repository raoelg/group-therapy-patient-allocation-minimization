/*
 * Group Therapy RTC Patient Assignment -- browser port of the R Shiny / flexdashboard app
 * (GroupTherapyPatientAllocationWebApp.Rmd + GroupTherapyPatientRandomization.R, 2020).
 *
 * Plain ES2018, no build step. The computational core (GTA.*) has no DOM dependencies and can be
 * loaded in Node with require('./app.js'); the user interface part only runs when a `document` exists.
 *
 * Reproducibility notes (see also README.md and the tooltips in index.html):
 *  - R's RNG is re-implemented exactly: Mersenne-Twister with set.seed() scrambling (src/main/RNG.c),
 *    unif_rand(), R_unif_index() for sample() in sample.kind "Rounding" (R < 3.6.0; the 2020 deployment
 *    ran R 3.5.2, so this is the default) and "Rejection" (R >= 3.6.0), and sample(x, 1, prob = p),
 *    which uses FixupProb() + ProbSampleNoReplace() (revsort heapsort + one unif_rand(); identical in
 *    R 3.5 and 3.6, independent of sample.kind).
 *  - R's sum() accumulates doubles in an x87 80-bit long double, and R 3.5's round(x, 10) (nmath/fround.c
 *    before R 4.0.0) also computes in long double. Both are emulated exactly (BigInt-based 64-bit-mantissa
 *    arithmetic with round-half-even), so imbalance values, their comparisons, round(imb, 10) and the
 *    cut() classes are bit-identical to R on x86_64 Linux.
 *  - read.csv() type guessing with stringsAsFactors = TRUE (R < 4.0), factor level order = sort() in the
 *    session collation (en_US.UTF-8 with ICU in the deployment: Intl.Collator('en-US'); 'C' optional),
 *    ftable() row order, dplyr 0.8.5 arrange_all()/arrange_at() (factors by level order, NA last, stable),
 *    rownames_to_column(), full_join() row order, group_by_at() group order + mutate(sample()) per group,
 *    as.matrix.data.frame() formatting of numeric columns (common width, as format()), write.csv().
 */
(function () {
  'use strict';

  // ======================================================================================
  // R random number generator (Mersenne-Twister, set.seed, unif_rand, R_unif_index, sample)
  // ======================================================================================
  const N = 624, M = 397;
  const MATRIX_A = 0x9908b0df, UPPER_MASK = 0x80000000, LOWER_MASK = 0x7fffffff;
  const TEMPERING_MASK_B = 0x9d2c5680, TEMPERING_MASK_C = 0xefc60000;
  const i2_32m1 = 2.328306437080797e-10; // 1/(2^32 - 1)

  class RRNG {
    constructor(seed, sampleKind) {
      this.mt = new Uint32Array(N);
      this.mti = N + 1;
      this.sampleKind = sampleKind === 'Rejection' ? 'Rejection' : 'Rounding';
      this.draws = 0; // number of unif_rand() calls (for the debug output)
      if (seed !== undefined && seed !== null) this.setSeed(seed);
    }
    /** set.seed(seed) for kind "Mersenne-Twister" (RNG_Init in src/main/RNG.c) */
    setSeed(seed) {
      seed = Number(seed);
      if (!isFinite(seed) || Math.abs(seed) >= 2147483648) throw new RError('supplied seed is not a valid integer', 'set.seed(val$rSeed)');
      let s = (Math.trunc(seed) | 0) >>> 0;              // asInteger(), then (Int32) = unsigned int
      for (let j = 0; j < 50; j++) s = (Math.imul(69069, s) + 1) >>> 0; // initial scrambling
      s = (Math.imul(69069, s) + 1) >>> 0;                // i_seed[0] (dummy[0] = mti) ...
      for (let j = 0; j < N; j++) { s = (Math.imul(69069, s) + 1) >>> 0; this.mt[j] = s; }
      this.mti = N;                                       // ... which FixupSeeds() sets to 624
      this.draws = 0;
    }
    /** Restore from R's .Random.seed (integer vector: 403 (R 3.5) / 10403 (R >= 3.6), mti, mt[0..623]) */
    setState(rs) {
      if (rs.length !== N + 2) throw new Error('.Random.seed must have length 626');
      this.mti = rs[1] | 0;
      for (let j = 0; j < N; j++) this.mt[j] = rs[j + 2] >>> 0;
    }
    /** .Random.seed[-1] equivalent: [mti, mt[0..623]] as signed 32-bit integers */
    getState() {
      const out = [this.mti];
      for (let j = 0; j < N; j++) out.push(this.mt[j] | 0);
      return out;
    }
    sgenrand(seed) {
      const mt = this.mt;
      for (let i = 0; i < N; i++) {
        mt[i] = seed & 0xffff0000;
        seed = (Math.imul(69069, seed) + 1) >>> 0;
        mt[i] = (mt[i] | ((seed & 0xffff0000) >>> 16)) >>> 0;
        seed = (Math.imul(69069, seed) + 1) >>> 0;
      }
      this.mti = N;
    }
    genrand() {
      const mt = this.mt;
      let y;
      if (this.mti >= N) {
        if (this.mti === N + 1) this.sgenrand(4357);
        let kk;
        for (kk = 0; kk < N - M; kk++) {
          y = (mt[kk] & UPPER_MASK) | (mt[kk + 1] & LOWER_MASK);
          mt[kk] = mt[kk + M] ^ (y >>> 1) ^ ((y & 1) ? MATRIX_A : 0);
        }
        for (; kk < N - 1; kk++) {
          y = (mt[kk] & UPPER_MASK) | (mt[kk + 1] & LOWER_MASK);
          mt[kk] = mt[kk + (M - N)] ^ (y >>> 1) ^ ((y & 1) ? MATRIX_A : 0);
        }
        y = (mt[N - 1] & UPPER_MASK) | (mt[0] & LOWER_MASK);
        mt[N - 1] = mt[M - 1] ^ (y >>> 1) ^ ((y & 1) ? MATRIX_A : 0);
        this.mti = 0;
      }
      y = mt[this.mti++];
      y ^= (y >>> 11);
      y ^= (y << 7) & TEMPERING_MASK_B;
      y ^= (y << 15) & TEMPERING_MASK_C;
      y ^= (y >>> 18);
      return (y >>> 0) * 2.3283064365386963e-10;
    }
    unifRand() {
      this.draws++;
      const x = this.genrand();
      if (x <= 0.0) return 0.5 * i2_32m1;
      if (1.0 - x <= 0.0) return 1.0 - 0.5 * i2_32m1;
      return x;
    }
    rbits(bits) {
      let v = 0;
      for (let n = 0; n <= bits; n += 16) {
        const v1 = Math.floor(this.unifRand() * 65536);
        v = 65536 * v + v1;
      }
      return v % Math.pow(2, bits); // == v & ((1 << bits) - 1) for the 64-bit v in R
    }
    /** R_unif_index(dn): uniform integer in 0..dn-1 */
    unifIndex(dn) {
      if (this.sampleKind === 'Rounding') return Math.floor(dn * this.unifRand());
      if (dn <= 0) return 0;
      let bits = 0;
      while (Math.pow(2, bits) < dn) bits++; // (int) ceil(log2(dn))
      let dv;
      do { dv = this.rbits(bits); } while (dn <= dv);
      return dv;
    }
    /** sample.int(n, size) without replacement and without prob (do_sample in src/main/random.c); 1-based */
    sampleInt(n, size) {
      if (size === undefined) size = n;
      if (size > 0 && n === 0) throw new RError('invalid first argument', 'sample.int(length(x), size, replace, prob)');
      if (size > n) throw new RError('cannot take a sample larger than the population when \'replace = FALSE\'', 'sample.int(length(x), size, replace, prob)');
      const y = new Array(size);
      if (size < 2) {
        for (let i = 0; i < size; i++) y[i] = this.unifIndex(n) + 1;
        return y;
      }
      const x = new Array(n);
      for (let i = 0; i < n; i++) x[i] = i;
      let nn = n;
      for (let i = 0; i < size; i++) {
        const j = this.unifIndex(nn);
        y[i] = x[j] + 1;
        x[j] = x[--nn];
      }
      return y;
    }
    /** sample.int(n, size, replace = FALSE, prob): FixupProb() + ProbSampleNoReplace(); 1-based */
    sampleIntProb(n, size, prob) {
      if (prob.length !== n) throw new RError('incorrect number of probabilities', 'sample.int(length(x), size, replace, prob)');
      if (size > n) throw new RError('cannot take a sample larger than the population when \'replace = FALSE\'', 'sample.int(length(x), size, replace, prob)');
      const p = prob.slice();
      let sum = 0.0, npos = 0;                       // FixupProb (plain double sum)
      for (let i = 0; i < n; i++) {
        if (!isFinite(p[i])) throw new RError('NA in probability vector', 'sample.int(length(x), size, replace, prob)');
        if (p[i] < 0) throw new RError('negative probability', 'sample.int(length(x), size, replace, prob)');
        if (p[i] > 0) { npos++; sum += p[i]; }
      }
      if (npos === 0 || size > npos) throw new RError('too few positive probabilities', 'sample.int(length(x), size, replace, prob)');
      for (let i = 0; i < n; i++) p[i] /= sum;
      const perm = new Array(n);                     // ProbSampleNoReplace
      for (let i = 0; i < n; i++) perm[i] = i + 1;
      revsort(p, perm, n);
      const ans = [];
      let totalmass = 1;
      for (let i = 0, n1 = n - 1; i < size; i++, n1--) {
        const rT = totalmass * this.unifRand();
        let mass = 0, j;
        for (j = 0; j < n1; j++) {
          mass += p[j];
          if (rT <= mass) break;
        }
        ans.push(perm[j]);
        totalmass -= p[j];
        for (let k = j; k < n1; k++) { p[k] = p[k + 1]; perm[k] = perm[k + 1]; }
      }
      return ans;
    }
  }
  /** revsort() from src/main/sort.c: heapsort a[] into descending order, permuting ib[] alongside */
  function revsort(a0, ib0, n) {
    if (n <= 1) return;
    const a = [0].concat(a0), ib = [0].concat(ib0); // 1-based copies
    let l = (n >> 1) + 1, ir = n, i, j, ra, ii;
    for (;;) {
      if (l > 1) { l = l - 1; ra = a[l]; ii = ib[l]; }
      else {
        ra = a[ir]; ii = ib[ir]; a[ir] = a[1]; ib[ir] = ib[1];
        if (--ir === 1) { a[1] = ra; ib[1] = ii; break; }
      }
      i = l; j = l << 1;
      while (j <= ir) {
        if (j < ir && a[j] > a[j + 1]) ++j;
        if (ra > a[j]) { a[i] = a[j]; ib[i] = ib[j]; j += (i = j); }
        else j = ir + 1;
      }
      a[i] = ra; ib[i] = ii;
    }
    for (let k = 0; k < n; k++) { a0[k] = a[k + 1]; ib0[k] = ib[k + 1]; }
  }

  /** An R error (stop()), with the deparsed call for the "<simpleError in call: message>" display */
  class RError extends Error {
    constructor(message, call) { super(message); this.rcall = call || null; this.isRError = true; }
  }

  // ======================================================================================
  // x87 80-bit long double emulation (64-bit mantissa, round-half-even), for sum() and round()
  // ======================================================================================
  // A value is {s: +1|-1, m: BigInt (0 or 2^63 <= m < 2^64), e: exponent}; value = s * m * 2^e.
  const B0 = BigInt(0), B1 = BigInt(1), B2 = BigInt(2);
  const TWO63 = B1 << BigInt(63), TWO64 = B1 << BigInt(64), TWO52 = B1 << BigInt(52), TWO53 = B1 << BigInt(53);
  const f64 = new Float64Array(1), u64 = new BigUint64Array(f64.buffer);
  function bitLen(m) { // m > 0
    let n = 0, t = m;
    while (t >= TWO64) { t >>= BigInt(64); n += 64; }
    let x = Number(t); // < 2^64, may round up to 2^64 -> correct below
    let b = x === 0 ? 0 : Math.floor(Math.log2(x)) + 1;
    while (b > 0 && (B1 << BigInt(b - 1)) > t) b--;
    while ((B1 << BigInt(b)) <= t) b++;
    return n + b;
  }
  /** round s*m*2^e to `bits` significant bits (half-even); returns {s, m, e} with m normalized to `bits` */
  function roundBits(s, m, e, bits) {
    if (m === B0) return { s: 1, m: B0, e: 0 };
    const bl = bitLen(m);
    if (bl > bits) {
      const sh = BigInt(bl - bits);
      let q = m >> sh;
      const r = m - (q << sh), half = B1 << (sh - B1);
      if (r > half || (r === half && (q & B1) === B1)) q += B1;
      e += bl - bits;
      if (bitLen(q) > bits) { q >>= B1; e += 1; }
      return { s, m: q, e };
    }
    return { s, m: m << BigInt(bits - bl), e: e - (bits - bl) };
  }
  const LD = {
    fromDouble(x) {
      if (x === 0) return { s: 1, m: B0, e: 0 };
      if (!isFinite(x)) throw new Error('LD: non-finite');
      f64[0] = x;
      const bits = u64[0];
      const s = (bits >> BigInt(63)) ? -1 : 1;
      const ex = Number((bits >> BigInt(52)) & BigInt(0x7ff));
      let mant = bits & (TWO52 - B1);
      let e;
      if (ex === 0) e = -1074; else { mant |= TWO52; e = ex - 1075; }
      return roundBits(s, mant, e, 64);
    },
    add(a, b) {
      if (a.m === B0) return b;
      if (b.m === B0) return a;
      let e, ma, mb;
      if (a.e >= b.e) { e = b.e; ma = a.m << BigInt(a.e - b.e); mb = b.m; }
      else { e = a.e; ma = a.m; mb = b.m << BigInt(b.e - a.e); }
      let v = BigInt(a.s) * ma + BigInt(b.s) * mb;
      const s = v < B0 ? -1 : 1;
      if (v < B0) v = -v;
      return roundBits(s, v, e, 64);
    },
    neg(a) { return { s: -a.s, m: a.m, e: a.e }; },
    sub(a, b) { return LD.add(a, LD.neg(b)); },
    mul(a, b) {
      if (a.m === B0 || b.m === B0) return { s: 1, m: B0, e: 0 };
      return roundBits(a.s * b.s, a.m * b.m, a.e + b.e, 64);
    },
    div(a, b) {
      if (b.m === B0) throw new Error('LD: division by zero');
      if (a.m === B0) return a;
      const SH = BigInt(140);
      const num = a.m << SH;
      let q = num / b.m;
      const r = num - q * b.m;
      let e = a.e - b.e - 140;
      if (r !== B0) { q = (q << B1) | B1; e -= 1; } // sticky bit
      return roundBits(a.s * b.s, q, e, 64);
    },
    toDouble(a) {
      if (a.m === B0) return 0;
      const r = roundBits(a.s, a.m, a.e, 53);
      return a.s * Number(r.m) * Math.pow(2, r.e);
    }
  };
  /** sum() of a double vector as in R (rsum: long double accumulator) */
  function rsum(x) {
    let s = LD.fromDouble(0);
    for (let i = 0; i < x.length; i++) s = LD.add(s, LD.fromDouble(x[i]));
    return LD.toDouble(s);
  }
  /** C nearbyint() in the default rounding mode (round half to even) */
  function rint(x) {
    const f = Math.floor(x), d = x - f;
    if (d < 0.5) return f;
    if (d > 0.5) return f + 1;
    return (f % 2 === 0) ? f : f + 1;
  }
  /** round(x, digits) of R < 4.0.0 (src/nmath/fround.c, long double intermediates) */
  function fround(x, digits) {
    if (isNaN(x) || isNaN(digits)) return x + digits;
    if (!isFinite(x)) return x;
    if (digits === Infinity) return x; else if (digits === -Infinity) return 0.0;
    if (digits > 308) digits = 308;
    const dig = Math.floor(digits + 0.5);
    let sgn = 1;
    if (x < 0) { sgn = -1; x = -x; }
    if (dig === 0) return sgn * rint(x);
    if (dig > 0) {
      const pow10 = LD.fromDouble(rPowDi(10, dig));
      const fx = Math.floor(x), intx = LD.fromDouble(fx);
      const t = LD.toDouble(LD.mul(LD.sub(LD.fromDouble(x), intx), pow10));
      const q = LD.div(LD.fromDouble(rint(t)), pow10);
      const r = LD.add(intx, q);
      return sgn * LD.toDouble(r);
    }
    const pow10 = LD.fromDouble(rPowDi(10, -dig));
    return sgn * LD.toDouble(LD.mul(LD.fromDouble(rint(LD.toDouble(LD.div(LD.fromDouble(x), pow10)))), pow10));
  }
  function rPowDi(x, n) { // R_pow_di
    let xn = 1.0;
    if (n !== 0) {
      const neg = n < 0; if (neg) n = -n;
      for (;;) { if (n & 1) xn *= x; if (n >>= 1) x *= x; else break; }
      if (neg) xn = 1 / xn;
    }
    return xn;
  }

  // ======================================================================================
  // Small R-semantics helpers
  // ======================================================================================
  const isNA = v => v === null || v === undefined || (typeof v === 'number' && isNaN(v));

  function cCompare(a, b) { // C-locale (code point) comparison
    if (a === b) return 0;
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) {
      const ca = a.codePointAt(i), cb = b.codePointAt(i);
      if (ca !== cb) return ca < cb ? -1 : 1;
      if (ca > 0xffff) i++;
    }
    return a.length < b.length ? -1 : (a.length > b.length ? 1 : 0);
  }
  let _collator = null;
  /** string comparison of R's sort()/Scollate in the given collation ('locale' = ICU en_US, or 'C') */
  function makeCollate(collation) {
    if (collation === 'C') return cCompare;
    if (!_collator) _collator = new Intl.Collator('en-US');
    return (a, b) => { const r = _collator.compare(a, b); return r !== 0 ? r : cCompare(a, b); };
  }
  function stableSortIdx(n, cmp) {
    const idx = Array.from({ length: n }, (_, i) => i);
    idx.sort((i, j) => cmp(i, j) || (i - j));
    return idx;
  }
  /** as.character() of an R double: 15 significant digits ("%.15g"), R style exponent */
  function fmtDouble(x) {
    if (isNA(x)) return 'NA';
    if (!isFinite(x)) return x > 0 ? 'Inf' : '-Inf';
    if (x === 0) return '0';
    const p = Number(x.toPrecision(15));
    let sci = p.toExponential().replace(/e([+-])(\d)$/, 'e$10$2');
    let fixed = Math.abs(p) < 1e21 ? p.toFixed(Math.max(0, (() => {
      const m = sci.split('e'), digs = m[0].replace('-', '').replace('.', '').length;
      return Math.max(0, digs - 1 - parseInt(m[1], 10));
    })())) : sci;
    return fixed.length <= sci.length ? fixed : sci;
  }

  /** base::make.names(names, unique = TRUE) */
  const RESERVED = new Set(['if', 'else', 'repeat', 'while', 'function', 'for', 'next', 'break', 'TRUE', 'FALSE', 'NULL',
    'Inf', 'NaN', 'NA', 'NA_integer_', 'NA_real_', 'NA_character_', 'NA_complex_', 'in']);
  function makeNames(names, unique) {
    const out = names.map(nm => {
      let s = isNA(nm) ? 'NA' : String(nm);
      const ch = Array.from(s);
      if (ch.length === 0 || !(/[\p{L}.]/u.test(ch[0])) || (ch[0] === '.' && ch.length > 1 && /[0-9]/.test(ch[1]))) s = 'X' + s;
      s = Array.from(s).map(c => /[\p{L}\p{N}._]/u.test(c) ? c : '.').join('');
      if (RESERVED.has(s)) s += '.';
      return s;
    });
    if (!unique) return out;
    return makeUnique(out);
  }
  /** base::make.unique(names, sep = ".") */
  function makeUnique(names) {
    const out = names.slice(), used = new Set(names), seen = new Set(), cnt = new Map();
    for (let i = 0; i < out.length; i++) {
      const nm = names[i];
      if (!seen.has(nm)) { seen.add(nm); continue; }
      let c = cnt.get(nm) || 1, cand;
      do { cand = nm + '.' + c; c++; } while (used.has(cand));
      cnt.set(nm, c);
      used.add(cand);
      out[i] = cand;
    }
    return out;
  }

  // ======================================================================================
  // R vectors / data frames
  // ======================================================================================
  // A column is one of
  //   {type: 'factor', levels: [..], codes: [1-based int | null]}
  //   {type: 'integer' | 'double' | 'logical' | 'character', v: [.. | null]}
  // A data frame is {names: [..], cols: [..], nrow}.
  function colLen(c) { return c.type === 'factor' ? c.codes.length : c.v.length; }
  /** as.character(x[i]) (null for NA) */
  function asChar(c, i) {
    if (c.type === 'factor') { const k = c.codes[i]; return k === null ? null : c.levels[k - 1]; }
    const v = c.v[i];
    if (isNA(v)) return (c.type === 'double' && typeof v === 'number' && isNaN(v) && v !== null) ? 'NaN' : null;
    if (c.type === 'logical') return v ? 'TRUE' : 'FALSE';
    if (c.type === 'double') return fmtDouble(v);
    return String(v);
  }
  function asCharVec(c) { const n = colLen(c), out = new Array(n); for (let i = 0; i < n; i++) out[i] = asChar(c, i); return out; }
  function subsetCol(c, idx) { // idx: 0-based indices, -1 = NA
    if (c.type === 'factor') return { type: 'factor', levels: c.levels, codes: idx.map(i => i < 0 ? null : c.codes[i]) };
    return { type: c.type, v: idx.map(i => i < 0 ? null : c.v[i]) };
  }
  function isNumericCol(c) { return c.type === 'integer' || c.type === 'double'; }

  /** factor(x): levels = sort(unique(x)) (factors: used levels in level order), NA excluded */
  function factorDefault(c, collate) {
    const n = colLen(c);
    if (c.type === 'factor') {
      const used = new Set();
      for (const k of c.codes) if (k !== null) used.add(k);
      const keep = Array.from(used).sort((a, b) => a - b);
      const map = new Map(keep.map((k, i) => [k, i + 1]));
      return { type: 'factor', levels: keep.map(k => c.levels[k - 1]), codes: c.codes.map(k => k === null ? null : map.get(k)) };
    }
    // unique values, sorted (sort.list on the unique values), then as.character, then unique again
    const uniq = [];
    const seen = new Set();
    for (let i = 0; i < n; i++) {
      const v = c.v[i];
      if (v === null || v === undefined || (typeof v === 'number' && isNaN(v) && c.type !== 'double')) continue;
      const key = typeof v + ':' + String(v);
      if (!seen.has(key)) { seen.add(key); uniq.push(v); }
    }
    let sorted;
    if (c.type === 'character') sorted = uniq.slice().sort(collate);
    else if (c.type === 'logical') sorted = uniq.slice().sort((a, b) => (a ? 1 : 0) - (b ? 1 : 0));
    else sorted = uniq.filter(v => !isNaN(v)).sort((a, b) => a - b);  // NaN excluded too (exclude = NA)
    const tmp = { type: c.type, v: sorted };
    const levels = [];
    const ls = new Set();
    for (let i = 0; i < sorted.length; i++) { const s = asChar(tmp, i); if (!ls.has(s)) { ls.add(s); levels.push(s); } }
    return factorWithLevels(c, levels);
  }
  /** factor(x, levels): match(as.character(x), levels) */
  function factorWithLevels(c, levels) {
    const map = new Map();
    levels.forEach((l, i) => { if (!map.has(l)) map.set(l, i + 1); });
    const n = colLen(c), codes = new Array(n);
    for (let i = 0; i < n; i++) { const s = asChar(c, i); codes[i] = (s === null || !map.has(s)) ? null : map.get(s); }
    return { type: 'factor', levels: levels.slice(), codes };
  }

  // ======================================================================================
  // read.csv() (R 3.5: header = TRUE, sep = ",", quote = "\"", na.strings = "NA",
  //             stringsAsFactors = TRUE, check.names = TRUE, strip.white = FALSE)
  // ======================================================================================
  function csvRecords(text) {
    const recs = [];
    let i = 0;
    const n = text.length;
    while (i < n) {
      const rec = [];
      let field = '', inQ = false, quoted = false, any = false;
      for (; i < n; i++) {
        const ch = text[i];
        if (inQ) {
          if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
          else field += ch;
        } else if (ch === '"') { inQ = true; quoted = true; any = true; }
        else if (ch === ',') { rec.push({ s: field, q: quoted }); field = ''; quoted = false; any = true; }
        else if (ch === '\n' || ch === '\r') {
          if (ch === '\r' && text[i + 1] === '\n') i++;
          i++;
          break;
        } else { field += ch; any = true; }
      }
      if (any || field !== '') rec.push({ s: field, q: quoted });
      if (rec.length > 0 && !(rec.length === 1 && rec[0].s === '' && !rec[0].q)) recs.push(rec); // blank.lines.skip
    }
    return recs;
  }
  const LOGICAL_STR = new Set(['T', 'F', 'TRUE', 'FALSE', 'true', 'false', 'True', 'False']);
  function isBlank(s) { return /^[ \t\n\r]*$/.test(s); }
  /** R's Strtoi(s, 10): strtol with leading whitespace allowed, nothing after the digits */
  function strtoi(s) {
    if (!/^[ \t\n\r\f\v]*[+-]?\d+$/.test(s)) return null;
    const v = parseInt(s, 10);
    if (!isFinite(v) || v > 2147483647 || v < -2147483647) return null;
    return v;
  }
  /** R_strtod(): decimal / hex / Inf / NaN / NA, leading whitespace allowed, trailing blanks allowed */
  function strtod(s) {
    const t = s.replace(/^[ \t\n\r\f\v]+/, '').replace(/[ \t\n\r]+$/, '');
    if (/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(t)) return parseFloat(t);
    if (/^[+-]?0[xX][0-9a-fA-F]+$/.test(t)) return (t[0] === '-' ? -1 : 1) * parseInt(t.replace(/^[+-]?0[xX]/, ''), 16);
    if (/^[+-]?(Inf|inf|infinity|Infinity|INF)$/.test(t)) return t[0] === '-' ? -Infinity : Infinity;
    if (/^[+-]?NaN$/.test(t)) return NaN;
    if (t === 'NA') return null;
    return undefined;
  }
  /** type.convert(x, as.is = FALSE, na.strings = "NA") */
  function typeConvert(strs, collate) {
    const isNAs = s => s === null || s === 'NA';
    let isLogical = true, isInteger = true, isReal = true;
    for (const s of strs) {
      if (isNAs(s) || isBlank(s)) continue;
      if (isLogical && !LOGICAL_STR.has(s)) isLogical = false;
      if (isInteger && strtoi(s) === null) isInteger = false;
      if (isReal && strtod(s) === undefined) isReal = false;
      if (!isLogical && !isInteger && !isReal) break;
    }
    if (isLogical) return { type: 'logical', v: strs.map(s => (isNAs(s) || isBlank(s)) ? null : (s[0] === 'T' || s[0] === 't')) };
    if (isInteger) return { type: 'integer', v: strs.map(s => (isNAs(s) || isBlank(s)) ? null : strtoi(s)) };
    if (isReal) return { type: 'double', v: strs.map(s => (isNAs(s) || isBlank(s)) ? null : strtod(s)) };
    // factor; levels sorted in the session collation
    const lv = Array.from(new Set(strs.filter(s => !isNAs(s)))).sort(collate);
    const map = new Map(lv.map((l, i) => [l, i + 1]));
    return { type: 'factor', levels: lv, codes: strs.map(s => isNAs(s) ? null : map.get(s)) };
  }
  function decodeText(buf) {
    if (typeof buf === 'string') return buf;
    return new TextDecoder('utf-8').decode(buf); // keeps a UTF-8 BOM as U+FEFF, like R 3.5's read.csv
  }
  /** read.csv(file) of R 3.5 */
  function readCsv(text, opts) {
    opts = opts || {};
    const collate = makeCollate(opts.collation);
    text = decodeText(text);
    const recs = csvRecords(text);
    if (recs.length === 0) throw new RError('no lines available in input', 'read.table(file = file, header = header, sep = sep, quote = quote, ...)');
    const header = recs[0].map(f => f.s);
    const body = recs.slice(1);
    // number of columns from the first 5 lines (count.fields)
    let ncol = header.length;
    for (let i = 0; i < Math.min(5, body.length); i++) ncol = Math.max(ncol, body[i].length);
    let rowNamesFromFirst = false;
    if (header.length === ncol - 1) rowNamesFromFirst = true; // header one shorter: first column = row names
    const names = makeNames(rowNamesFromFirst ? header : header.slice(0, ncol), true);
    while (names.length < ncol - (rowNamesFromFirst ? 1 : 0)) names.push('V' + (names.length + 1));
    const nr = body.length;
    const cells = [];
    for (let j = 0; j < ncol; j++) cells.push(new Array(nr));
    for (let i = 0; i < nr; i++) for (let j = 0; j < ncol; j++) {
      const f = body[i][j];
      cells[j][i] = f === undefined ? null : f.s; // fill = TRUE: missing fields are NA
    }
    let rownames = null;
    let dataCells = cells;
    if (rowNamesFromFirst) { rownames = cells[0].map(s => s === null ? 'NA' : s); dataCells = cells.slice(1); }
    const cols = dataCells.map(strs => typeConvert(strs, collate));
    return { names: names.slice(0, cols.length), cols, nrow: nr, rownames };
  }

  // ======================================================================================
  // 'Available spots' text -> named numeric vector k (as the observer in the Rmd)
  // ======================================================================================
  /**
   * The original checks every comma-separated piece with grepl("\\w+\\s*=\\s*\\d", .), turns name = 3
   * into "name" = 3 with gsub() and evaluates paste("c(", ., ")") as R code (eval(parse())).
   * Evaluating arbitrary text is not possible (nor desirable) here: this accepts exactly what the
   * original accepts for the intended input "name = number, name = number, ..." (number = an R numeric
   * literal) and reports "Error in 'Available spots'" for anything else.
   */
  function parseSpots(txt) {
    if (txt === null || txt === undefined || txt === '') return { ok: false, empty: true };
    const W = '[\\p{L}\\p{N}_]';
    const pieces = txt.split(',');
    if (txt.endsWith(',')) pieces.pop(); // strsplit drops a trailing empty piece
    if (pieces.length === 0 || !pieces.every(p => new RegExp(W + '+\\s*=\\s*\\d', 'u').test(p))) return { ok: false, error: "Error in 'Available spots'" };
    const names = [], values = [];
    const re = new RegExp('^\\s*(' + W + '+)\\s*=\\s*([+-]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][+-]?\\d+)?|0[xX][0-9a-fA-F]+)\\s*$', 'u');
    for (const p of pieces) {
      const m = re.exec(p);
      if (!m) return { ok: false, error: "Error in 'Available spots'", unsupported: true };
      names.push(m[1]);
      values.push(Number(m[2]));
    }
    return { ok: true, k: { names, values } };
  }

  // ======================================================================================
  // ftable(), ftable_imbalance()
  // ======================================================================================
  /**
   * ftable(table(df), col.vars = colVar): returns {rowVars: [{name, levels}], colLevels, nrow, ncol,
   * data: Float64Array (column-major nrow x ncol)}. ftable rows: the first row variable varies slowest.
   */
  function ftableOf(df, colVar) {
    const rv = [], rcols = [];
    let ccol = null;
    df.names.forEach((nm, j) => { if (nm === colVar) ccol = df.cols[j]; else { rv.push({ name: nm, levels: df.cols[j].levels }); rcols.push(df.cols[j]); } });
    const nrow = rv.reduce((a, v) => a * v.levels.length, 1), ncol = ccol.levels.length;
    const data = new Float64Array(nrow * ncol);
    for (let i = 0; i < df.nrow; i++) {
      let r = 0, na = false;
      for (let q = 0; q < rcols.length; q++) {
        const k = rcols[q].codes[i];
        if (k === null) { na = true; break; }
        r = r * rv[q].levels.length + (k - 1);
      }
      const c = ccol.codes[i];
      if (na || c === null) continue;
      data[c * nrow - nrow + r] += 1;
    }
    return { rowVars: rv, colLevels: ccol.levels, nrow, ncol, data };
  }
  /**
   * ftable_imbalance(O, chi2 = 1, WSS = 0, BSS = 0) with O = current + new counts (column-major).
   * E = outer(rowSums(O), colSums(O)) / sum(O) + 0.0001; X2 = sum((O - E)^2 / E) (long double sum);
   * the WSS/BSS terms are multiplied by 0 (NaN only when O has a single column).
   */
  function imbalance(O, nrow, ncol, cache) {
    const rs = cache && cache.rs ? cache.rs : new Float64Array(nrow), cs = cache && cache.cs ? cache.cs : new Float64Array(ncol);
    let tot = 0;
    if (!(cache && cache.rs)) {
      for (let j = 0; j < ncol; j++) for (let i = 0; i < nrow; i++) { const o = O[j * nrow + i]; rs[i] += o; cs[j] += o; }
    }
    for (let j = 0; j < ncol; j++) tot += cs[j];
    let s = LD.fromDouble(0);
    for (let j = 0; j < ncol; j++) for (let i = 0; i < nrow; i++) {
      const o = O[j * nrow + i];
      const E = (rs[i] * cs[j]) / tot + 0.0001;
      const d = o - E;
      const v = (d * d) / E;
      if (isNaN(v)) return NaN;
      s = LD.add(s, LD.fromDouble(v));
    }
    const X2 = LD.toDouble(s);
    if (ncol < 2) return NaN; // var() of single values is NA, 0 * NA = NA
    return X2;
  }

  // ======================================================================================
  // generatePatientAllocation3(), sampleAllocation(), matchPositionsPatients()
  // ======================================================================================
  /** sample(x) where x is an integer vector (which() result): note the length-1 pitfall */
  function sampleWhich(rng, w) {
    if (w.length === 1 && w[0] >= 1) return rng.sampleInt(w[0], w[0]);       // sample(5) == sample.int(5)
    const p = rng.sampleInt(w.length, w.length);
    return p.map(i => w[i - 1]);
  }
  /** cut(x, breaks)'s .bincode(x, breaks, right = TRUE, include.lowest = FALSE): 1-based or null */
  function bincode(x, B) {
    const nb = B.length;
    if (isNaN(x)) return null;
    let lo = 0, hi = nb - 1;
    if (x < B[lo] || B[hi] < x || x === B[lo]) return null;
    while (hi - lo >= 2) {
      const nw = (hi + lo) >> 1;
      if (x > B[nw]) lo = nw; else hi = nw;
    }
    return lo + 1;
  }

  function generatePatientAllocation3(theDf, nw, k, rng, info) {
    const nnew = nw.nrow;
    const sumk = rsum(k.values);
    const K = { names: k.names.concat(['wait']), values: k.values.concat([Math.max(0, nnew - sumk)]) };
    if (isNaN(nnew - sumk)) K.values[K.values.length - 1] = NaN;
    const armIdx = theDf.names.indexOf('arm');
    const armCol = theDf.cols[armIdx];
    const levelsWait = (armCol.type === 'factor' ? armCol.levels : []).concat(['wait']);
    if (new Set(levelsWait).size !== levelsWait.length) {
      const d = levelsWait.findIndex((l, i) => levelsWait.indexOf(l) !== i);
      throw new RError('factor level [' + (d + 1) + '] is duplicated', 'factor(sample(rep(names(K), K))[1:nnew], levels = levels_wait)');
    }
    // sample(rep(names(K), K))[1:nnew]
    const reps = [];
    K.values.forEach((t, i) => {
      const ti = Math.trunc(t);
      if (!(ti >= 0)) throw new RError("invalid 'times' argument", 'rep(names(K), K)');
      for (let r = 0; r < ti; r++) reps.push(K.names[i]);
    });
    const perm = rng.sampleInt(reps.length, reps.length);
    const drawn = perm.map(i => reps[i - 1]);
    if (nnew === 0) throw new RError('arguments imply differing number of rows: 0, 1', 'data.frame(..., check.names = FALSE)');
    const initial = [];
    for (let i = 0; i < nnew; i++) initial.push(i < drawn.length ? drawn[i] : null);
    info.K = K; info.levels_wait = levelsWait; info.initial_draw = initial; info.rep_length = reps.length;
    const armNew = factorWithLevels({ type: 'character', v: initial }, levelsWait);
    const newAlloc = { names: nw.names.concat(['arm']), cols: nw.cols.concat([armNew]), nrow: nnew };
    const dfT = { names: theDf.names, cols: theDf.cols.map((c, j) => j === armIdx ? factorWithLevels(c, levelsWait) : c), nrow: theDf.nrow };
    const cur = ftableOf(dfT, 'arm');
    const ncnt = ftableOf(newAlloc, 'arm');
    info.current_counts = cur; info.new_counts_initial = ncnt;
    if (cur.nrow !== ncnt.nrow || cur.ncol !== ncnt.ncol) throw new RError('non-conformable arrays', 'current_counts + new_counts');
    const nrow = ncnt.nrow, ncol = ncnt.ncol, ncell = nrow * ncol;
    const curD = cur.data;
    const combined = c => { const o = new Float64Array(ncell); for (let q = 0; q < ncell; q++) o[q] = curD[q] + c[q]; return o; };
    let counts = ncnt.data.slice();
    let imb = imbalance(combined(counts), nrow, ncol);
    const rsNew = [];
    for (let i = 0; i < nrow; i++) { let s = 0; for (let j = 0; j < ncol; j++) s += counts[j * nrow + i]; rsNew.push(s); }
    const w = []; rsNew.forEach((s, i) => { if (s > 0) w.push(i + 1); });
    const nonZeroRows = sampleWhich(rng, w);
    info.which_nonzero = w; info.non_zero_rows = nonZeroRows;
    // row/column sums of current + new are invariant under the exchanges: cache them
    const O0 = combined(counts);
    const cache = { rs: new Float64Array(nrow), cs: new Float64Array(ncol) };
    for (let j = 0; j < ncol; j++) for (let i = 0; i < nrow; i++) { cache.rs[i] += O0[j * nrow + i]; cache.cs[j] += O0[j * nrow + i]; }
    const trace = [{ imb, counts: counts.slice(), iter: 0 }];
    const iterations = [];
    let decr = 1, iter = 0;
    const O = new Float64Array(ncell);
    for (;;) {
      if (isNaN(decr)) throw new RError('missing value where TRUE/FALSE needed', 'while (decr > 0) {...}');
      if (!(decr > 0)) break;
      iter++;
      let best = counts, bestImb = imb, nconsidered = 0;
      const keep = counts;
      for (const i of nonZeroRows) for (const j of nonZeroRows) {
        if (i >= j) continue;
        for (let cf = 1; cf <= ncol; cf++) for (let ct = 1; ct <= ncol; ct++) {
          if (ct === cf) continue;
          const a = (cf - 1) * nrow + (i - 1), b = (ct - 1) * nrow + (i - 1), c = (ct - 1) * nrow + (j - 1), d = (cf - 1) * nrow + (j - 1);
          if (!(keep[a] >= 1)) continue;
          if (!(keep[c] >= 1)) continue;
          const cand = keep.slice();
          cand[a] -= 1; cand[b] += 1; cand[c] -= 1; cand[d] += 1;
          for (let q = 0; q < ncell; q++) O[q] = curD[q] + cand[q];
          const newImb = imbalance(O, nrow, ncol, cache);
          if (isNaN(newImb) || isNaN(bestImb)) throw new RError('missing value where TRUE/FALSE needed', 'if (new_imb < best_imb) {...}');
          if (newImb < bestImb) { best = cand; bestImb = newImb; }
          nconsidered++;
          trace.push({ imb: newImb, counts: cand, iter, i, j, col_from: cf, col_to: ct });
        }
      }
      iterations.push({ iter, imb_before: imb, best_imb: bestImb, considered: nconsidered });
      counts = best;
      decr = imb - bestImb;
      imb = bestImb;
    }
    info.iterations = iterations;
    return { counts, imb, trace, nrow, ncol, rowVars: ncnt.rowVars, colLevels: ncnt.colLevels };
  }

  function sampleAllocation(alloc, a, rng, info) {
    const tr = alloc.trace;
    const imb = tr.map(t => t.imb);
    const rounded = imb.map(v => fround(v, 10));
    const u = [];
    const seen = new Set();
    for (const v of rounded) { if (isNaN(v)) continue; const key = v === 0 ? 0 : v; if (!seen.has(key)) { seen.add(key); u.push(v); } }
    const x = u.sort((p, q) => p - q);
    info.unique_imb = x;
    if (x.length === 1) { info.early_return = true; info.sampled_index = 1; return tr[0]; }
    let md = Infinity;
    for (let q = 1; q < x.length; q++) md = Math.min(md, x[q] - x[q - 1]);
    const breaks = [0].concat(x.map(v => v + md / 2), [Infinity]);
    for (let q = 1; q < breaks.length; q++) if (!(breaks[q] > breaks[q - 1])) throw new RError("'breaks' are not unique", 'cut.default(x, breaks)');
    const y = x.map(v => bincode(v, breaks));
    const n = x.length;
    const e1 = x.map((_, q) => q === 0 ? 1 : 0);
    const s1 = rsum(e1.map(e => 1 - e));
    const p = e1.map(e => a * e + ((1 - a) * (1 - e)) / s1);
    const g = imb.map(v => bincode(v, breaks));
    const kIdx = rng.sampleIntProb(n, 1, p)[0];
    const kClass = y[kIdx - 1];
    const members = [];
    g.forEach((c, q) => { if (c !== null && c === kClass) members.push(q + 1); });
    let iSel;
    if (members.length === 1) iSel = members[0];
    else iSel = members[rng.sampleInt(members.length, 1)[0] - 1];
    Object.assign(info, { breaks, p_y: p, class_sampled: kClass, class_members: members.length, sampled_index: iSel });
    return tr[iSel - 1];
  }

  /** dplyr 0.8.5 arrange(): stable sort; factors by level code; NA last */
  function arrangeIdx(n, keyCols, collate) {
    const cmpCol = (c, i, j) => {
      let a, b;
      if (c.type === 'factor') { a = c.codes[i]; b = c.codes[j]; }
      else { a = c.v[i]; b = c.v[j]; }
      const na = isNA(a), nb = isNA(b);
      if (na || nb) return na === nb ? 0 : (na ? 1 : -1);
      if (c.type === 'character') return collate(a, b);
      if (c.type === 'logical') return (a ? 1 : 0) - (b ? 1 : 0);
      return a < b ? -1 : (a > b ? 1 : 0);
    };
    return stableSortIdx(n, (i, j) => { for (const c of keyCols) { const r = cmpCol(c, i, j); if (r) return r; } return 0; });
  }
  const keyOf = (c, i) => { const v = c.type === 'factor' ? c.codes[i] : c.v[i]; return isNA(v) ? '\u0000NA' : 's' + v; };

  function matchPositionsPatients(sel, alloc, nw, rng, collate, info) {
    const { nrow, ncol, rowVars, colLevels } = alloc;
    const counts = sel.counts;
    // positions: one row per allocated spot, sorted by (covariates..., arm) (= arrange_all())
    const nv = rowVars.length;
    const pos = { cov: rowVars.map(() => []), arm: [] };
    const sizes = rowVars.map(v => v.levels.length);
    for (let r = 0; r < nrow; r++) {
      const codes = new Array(nv);
      let rr = r;
      for (let q = nv - 1; q >= 0; q--) { codes[q] = (rr % sizes[q]) + 1; rr = Math.floor(rr / sizes[q]); }
      for (let c = 0; c < ncol; c++) {
        const f = counts[c * nrow + r];
        for (let t = 0; t < Math.trunc(f); t++) { codes.forEach((k, q) => pos.cov[q].push(k)); pos.arm.push(c + 1); }
      }
    }
    // (rows enumerated with the first covariate slowest and arm fastest = the arrange_all() order)
    const npos = pos.arm.length;
    if (npos === 0) throw new RError("invalid 'times' argument", 'rep(1:nrow(x), x$Freq)');
    // patients: new %>% rownames_to_column() %>% arrange_at(vars(-patient_id))
    const ord = arrangeIdx(nw.nrow, nw.cols, collate);
    const pat = { pid: ord.map(i => String(i + 1)), cov: nw.cols.map(c => ord.map(i => c.codes[i])) };
    // full_join by rowname + covariates (NA matches NA); x rows in order, then unmatched y rows
    const posKey = q => String(q + 1) + '|' + pos.cov.map(cc => cc[q] === null ? 'NA' : cc[q]).join('|');
    const posMap = new Map();
    for (let q = 0; q < npos; q++) posMap.set(posKey(q), q);
    const out = { pid: [], cov: nw.cols.map(() => []), arm: [] };
    const used = new Uint8Array(npos);
    for (let r = 0; r < nw.nrow; r++) {
      const key = String(r + 1) + '|' + pat.cov.map(cc => cc[r] === null ? 'NA' : cc[r]).join('|');
      const q = posMap.has(key) ? posMap.get(key) : -1;
      out.pid.push(pat.pid[r]);
      pat.cov.forEach((cc, v) => out.cov[v].push(cc[r]));
      out.arm.push(q >= 0 ? pos.arm[q] : null);
      if (q >= 0) used[q] = 1;
    }
    let unmatched = 0;
    for (let q = 0; q < npos; q++) if (!used[q]) {
      unmatched++;
      out.pid.push(null);
      pos.cov.forEach((cc, v) => out.cov[v].push(cc[q]));
      out.arm.push(pos.arm[q]);
    }
    info.unmatched_positions = unmatched;
    info.unmatched_patients = out.arm.slice(0, nw.nrow).filter(a => a === null).length;
    const nOut = out.pid.length;
    const covCols = nw.cols.map((c, v) => ({ type: 'factor', levels: c.levels, codes: out.cov[v] }));
    // group_by_at(covariates): groups in sorted key order (factor codes, NA last); mutate(sample()) per group
    const gord = arrangeIdx(nOut, covCols, collate);
    const groups = [];
    let last = null;
    const gkey = i => covCols.map(c => keyOf(c, i)).join('|');
    const gmap = new Map();
    for (const i of gord) {
      const kk = gkey(i);
      if (kk !== last) { gmap.set(kk, groups.length); groups.push([]); last = kk; }
    }
    for (let i = 0; i < nOut; i++) groups[gmap.get(gkey(i))].push(i); // rows of each group in data order
    const pidNew = out.pid.slice();
    info.group_sizes = groups.map(g => g.length);
    for (const g of groups) {
      const vals = g.map(i => out.pid[i]);
      const p = rng.sampleInt(vals.length, vals.length); // sample() of a character vector
      g.forEach((i, t) => { pidNew[i] = vals[p[t] - 1]; });
    }
    // arrange(patient_id): character sort (collation), NA last
    const fin = arrangeIdx(nOut, [{ type: 'character', v: pidNew }], collate);
    return {
      pid: fin.map(i => pidNew[i]),
      cov: covCols.map(c => ({ type: 'factor', levels: c.levels, codes: fin.map(i => c.codes[i]) })),
      arm: { type: 'factor', levels: colLevels, codes: fin.map(i => out.arm[i]) }
    };
  }

  // ======================================================================================
  // format() / as.matrix.data.frame() / write.csv()
  // ======================================================================================
  /** sig. digits (<= digits) and exponent of |x| as R's scientific() (format.c) */
  function sciInfo(x, digits) {
    const s = Math.abs(x).toExponential(digits - 1);
    let [mant, ex] = s.split('e');
    let kp = parseInt(ex, 10);
    let dg = mant.replace('.', '').replace(/0+$/, '');
    const nsig = Math.max(1, dg.length);
    return { kp, nsig };
  }
  /** format() of a numeric vector (formatReal / formatInteger, digits = 7), NA as "NA", common width */
  function formatNumeric(c) {
    const v = c.v, n = v.length;
    const hasNA = v.some(isNA);
    if (c.type === 'integer') {
      const s = v.map(x => isNA(x) ? 'NA' : String(x));
      const w = Math.max(hasNA ? 2 : 1, ...s.map(t => t.length));
      return s.map(t => t.padStart(w));
    }
    const digits = 7;
    let mxsl = -Infinity, rgt = 0, mxe = 1, mxns = 1, neg = 0, naflag = false, anyFinite = false, posinf = false, neginf = false, nanflag = false;
    let mnexp = Infinity, mxexp = -Infinity;
    for (const x of v) {
      if (x === null || x === undefined) { naflag = true; continue; }
      if (isNaN(x)) { nanflag = true; continue; }
      if (!isFinite(x)) { if (x > 0) posinf = true; else neginf = true; continue; }
      anyFinite = true;
      if (x < 0) neg = 1;
      let kp, nsig;
      if (x === 0) { kp = 0; nsig = 1; } else ({ kp, nsig } = sciInfo(x, digits));
      const sleft = (x < 0 ? 1 : 0) + (kp >= 0 ? kp + 1 : 1);
      const r = Math.max(0, nsig - kp - 1);
      if (r > rgt) rgt = r;
      if (sleft > mxsl) mxsl = sleft;
      if (kp > mxexp) mxexp = kp;
      if (kp < mnexp) mnexp = kp;
      if (nsig > mxns) mxns = nsig;
    }
    let w, d, e = 0;
    if (anyFinite) {
      if (rgt > 15) rgt = 15; // R_dec_min_exponent guard (approx.)
      const wF = mxsl + (rgt ? rgt + 1 : 0);
      mxe = (mxexp >= 100 || mnexp <= -100) ? 2 : 1;
      const wE = neg + (mxns > 1 ? mxns + 1 : mxns) + 4 + (mxe - 1);
      if (wF <= wE) { w = wF; d = rgt; e = 0; } else { w = wE; d = mxns - 1; e = mxe; }
    } else { w = 0; d = 0; }
    if (naflag) w = Math.max(w, 2);
    if (nanflag) w = Math.max(w, 3);
    if (posinf) w = Math.max(w, 3);
    if (neginf) w = Math.max(w, 4);
    return v.map(x => {
      let s;
      if (x === null || x === undefined) s = 'NA';
      else if (isNaN(x)) s = 'NaN';
      else if (!isFinite(x)) s = x > 0 ? 'Inf' : '-Inf';
      else if (e) s = x.toExponential(d).replace(/e([+-])(\d)$/, 'e$10$2');
      else s = x.toFixed(d);
      return s.padStart(w);
    });
  }
  /** format() of a logical vector */
  function formatLogical(c) {
    const s = c.v.map(x => isNA(x) ? 'NA' : (x ? 'TRUE' : 'FALSE'));
    const w = Math.max(...s.map(t => t.length), 0);
    return s.map(t => t.padStart(w));
  }
  /**
   * as.matrix(as.data.frame(df)) -> character matrix (array of string|null columns), as R does when the
   * data frame has a non-numeric column: factors -> labels, numbers/logicals -> format() (common width),
   * NAs kept. Returns {names, cols: [[..]], numeric: bool}.
   */
  function asCharMatrix(df, rVersion) {
    const nonNumeric = df.cols.some(c => c.type === 'factor' || c.type === 'character');
    if (!nonNumeric) return { names: df.names, cols: null, numeric: true };
    const cols = df.cols.map(c => {
      if (c.type === 'character') return c.v.slice();
      const miss = Array.from({ length: colLen(c) }, (_, i) => c.type === 'factor' ? c.codes[i] === null : isNA(c.v[i]));
      let s;
      if (c.type === 'factor') s = asCharVec(c);
      else if (c.type === 'logical') s = rVersion === '3.6' ? c.v.map(x => isNA(x) ? null : (x ? 'TRUE' : 'FALSE')) : formatLogical(c); // R >= 3.6.0: as.character()
      else s = formatNumeric(c);
      return s.map((t, i) => miss[i] ? null : t);
    });
    return { names: df.names, cols, numeric: false };
  }
  /** write.csv(df, quote = 1:ncol(df), row.names = FALSE) of a character data frame */
  function writeCsv(t) {
    const q = s => '"' + String(s).replace(/"/g, '""') + '"';
    const lines = [t.names.map(q).join(',')];
    for (const r of t.rows) lines.push(r.map(v => v === null ? 'NA' : q(v)).join(','));
    return lines.join('\n') + '\n';
  }

  // ======================================================================================
  // groupTherapyAllocate()
  // ======================================================================================
  const CALL_GTA = 'groupTherapyAllocate(df, new, k, input$patient_id, val$predictability)';
  function dropCol(df, name) {
    const j = df.names.indexOf(name);
    return { names: df.names.filter((_, q) => q !== j), cols: df.cols.filter((_, q) => q !== j), nrow: df.nrow, rownames: df.rownames };
  }
  /**
   * groupTherapyAllocate(existing_patients, new_patients, k, patient_id_column, predictability), after
   * set.seed(seed). Returns {alloc: {names, rows}, combined: {names, rows}, info} or throws an RError.
   */
  function groupTherapyAllocate(existing, newp, k, pid, predictability, rng, opts) {
    opts = opts || {};
    const collate = makeCollate(opts.collation);
    const info = {};
    if (pid === null || pid === undefined) pid = '';
    const theDf0 = existing.names.indexOf(pid) >= 0 ? dropCol(existing, pid) : existing;
    const new0 = newp.names.indexOf(pid) >= 0 ? dropCol(newp, pid) : newp;
    const a = theDf0.names, b = new0.names;
    const extra = Array.from(new Set(a.filter(x => b.indexOf(x) < 0).concat(b.filter(x => a.indexOf(x) < 0))));
    info.extra_name = extra;
    const hasArm = theDf0.names.indexOf('arm') >= 0;
    const msg1 = "The only difference between df and new should be an extra 'arm' column in df.\n  Specify 'patient_id_column' to indicate an extra patient id column in new.";
    if (extra.length === 0) throw new RError('argument is of length zero', 'if (length(extra_name) > 1 | extra_name != "arm" | is.null(the_df$arm)) stop(...)');
    if (extra.length > 1 || extra[0] !== 'arm' || !hasArm) throw new RError(msg1, CALL_GTA);
    const armCol = theDf0.cols[theDf0.names.indexOf('arm')];
    const armVals = new Set(asCharVec(armCol).filter(v => v !== null));
    if (!k.names.every(nm => armVals.has(nm))) throw new RError('The array k should be named with names that are levels in df[,"arm"].', CALL_GTA);
    // make sure that all factors in df and newAlloc have same levels
    const theDf = { names: theDf0.names.slice(), cols: theDf0.cols.slice(), nrow: theDf0.nrow };
    const nw = { names: new0.names.slice(), cols: new0.cols.slice(), nrow: new0.nrow };
    for (const nm of nw.names) {
      const jd = theDf.names.indexOf(nm), jn = nw.names.indexOf(nm);
      theDf.cols[jd] = factorDefault(theDf.cols[jd], collate);
      nw.cols[jn] = factorWithLevels(nw.cols[jn], theDf.cols[jd].levels);
    }
    info.covariates = nw.names.map((nm, j) => ({ name: nm, levels: nw.cols[j].levels }));
    info.new_na_strata = 0;
    for (let i = 0; i < nw.nrow; i++) if (nw.cols.some(c => c.codes[i] === null)) info.new_na_strata++;
    const alloc = generatePatientAllocation3(theDf, nw, k, rng, info);
    info.final_imb = alloc.imb;
    info.final_counts = alloc.counts;
    info.trace = alloc.trace;
    info.rowVars = alloc.rowVars; info.colLevels = alloc.colLevels; info.nrow = alloc.nrow; info.ncol = alloc.ncol;
    const sel = sampleAllocation(alloc, predictability, rng, info);
    info.sampled_counts = sel.counts;
    info.sampled_imb = sel.imb;
    const m = matchPositionsPatients(sel, alloc, nw, rng, collate, info);
    // patient_id column: original IDs (if the ID column is in new_patients) or the row numbers
    let pidCol, pidName;
    if (newp.names.indexOf(pid) >= 0) {
      const src = newp.cols[newp.names.indexOf(pid)];
      const idx = m.pid.map(s => s === null ? -1 : parseInt(s, 10) - 1);
      pidCol = subsetCol(src, idx);
      pidName = pid;
    } else { pidCol = { type: 'character', v: m.pid }; pidName = 'patient_id'; }
    const allocDf = { names: [pidName].concat(nw.names, ['arm']), cols: [pidCol].concat(m.cov, [m.arm]), nrow: m.pid.length };
    const allocM = asCharMatrix(allocDf, opts.rVersion);
    const exM = asCharMatrix(existing, opts.rVersion);
    if (exM.numeric) throw new RError('Column `' + existing.names[0] + '` can\'t be converted from numeric to character', 'bind_rows_(x, .id)');
    const toRows = (mm, n) => Array.from({ length: n }, (_, i) => mm.cols.map(c => c[i]));
    const allocT = { names: allocM.names, rows: toRows(allocM, allocDf.nrow) };
    // bind_rows(existing, alloc): columns matched by name, new columns appended, missing = NA
    const names = exM.names.slice();
    allocM.names.forEach(nm => { if (names.indexOf(nm) < 0) names.push(nm); });
    const rows = [];
    for (let i = 0; i < existing.nrow; i++) rows.push(names.map(nm => { const j = exM.names.indexOf(nm); return j < 0 ? null : exM.cols[j][i]; }));
    for (let i = 0; i < allocDf.nrow; i++) rows.push(names.map(nm => { const j = allocM.names.indexOf(nm); return j < 0 ? null : allocM.cols[j][i]; }));
    return { alloc: allocT, combined: { names, rows }, info, k };
  }

  /** Download file name of the downloadHandler */
  function downloadName(spotsText, seed, date) {
    return 'allocation-(' + spotsText + ',seed=' + rSeedText(seed) + ')-' + date + '.csv';
  }
  function rSeedText(seed) { return isNA(seed) ? 'NA' : fmtDouble(Number(seed)); }

  /** Run the server logic of the Rmd for one set of inputs (no DOM). */
  function runAll(o) {
    const out = { errors: {} };
    const rng = new RRNG(null, o.sampleKind || 'Rounding');
    out.rng = rng;
    try { rng.setSeed(o.seed); }
    catch (e) { out.error = e; return out; }
    try {
      out.result = groupTherapyAllocate(o.existing, o.newp, o.k, o.pid, o.predictability === undefined ? 0.8 : o.predictability, rng, { collation: o.collation, rVersion: o.rVersion || (o.sampleKind === 'Rejection' ? '3.6' : '3.5') });
      out.download = writeCsv(out.result.combined);
    } catch (e) {
      if (!e.isRError) throw e;
      out.error = e;
    }
    out.rngState = rng.getState();
    return out;
  }

  // ======================================================================================
  // print() approximations for the Debug tab (print.data.frame, named vectors, tibbles)
  // ======================================================================================
  function displayStr(c, i) { // print.data.frame cell
    if (c.type === 'factor' || c.type === 'character') { const s = asChar(c, i); return s === null ? '<NA>' : s; }
    return null;
  }
  function formatColForPrint(c) {
    if (c.type === 'factor' || c.type === 'character') return Array.from({ length: colLen(c) }, (_, i) => displayStr(c, i));
    if (c.type === 'logical') return c.v.map(x => isNA(x) ? 'NA' : (x ? 'TRUE' : 'FALSE'));
    return formatNumeric(c).map(s => s.trim());
  }
  function wrapBlocks(headerCells, colsCells, rowLabels, width, leftAlignCols) {
    // columns are right-aligned (print.data.frame default right = TRUE); row names left-aligned
    const rw = Math.max(0, ...rowLabels.map(s => s.length));
    const cw = headerCells.map((h, j) => Math.max(h.length, ...colsCells[j].map(s => s.length)));
    const lines = [];
    let j0 = 0;
    while (j0 < headerCells.length) {
      let tot = rw, j1 = j0;
      while (j1 < headerCells.length && (j1 === j0 || tot + 1 + cw[j1] <= width)) { tot += 1 + cw[j1]; j1++; }
      const pad = (s, w, left) => left ? s.padEnd(w) : s.padStart(w);
      lines.push(''.padEnd(rw) + headerCells.slice(j0, j1).map((h, q) => ' ' + pad(h, cw[j0 + q], leftAlignCols && leftAlignCols[j0 + q])).join(''));
      rowLabels.forEach((rl, i) => lines.push(rl.padEnd(rw) + colsCells.slice(j0, j1).map((cc, q) => ' ' + pad(cc[i], cw[j0 + q], leftAlignCols && leftAlignCols[j0 + q])).join('')));
      j0 = j1;
    }
    return lines.join('\n');
  }
  function printDataFrame(df, width) {
    width = width || 80;
    if (df.cols.length === 0) return 'data frame with 0 columns and ' + df.nrow + ' rows';
    if (df.nrow === 0) return '[1] ' + df.names.join(' ') + '\n<0 rows> (or 0-length row.names)';
    const rl = df.rownames || Array.from({ length: df.nrow }, (_, i) => String(i + 1));
    return wrapBlocks(df.names, df.cols.map(formatColForPrint), rl, width);
  }
  function printNamedNumeric(k, width) {
    width = width || 80;
    const vals = formatNumeric({ type: 'double', v: k.values }).map(s => s.trim());
    const w = Math.max(...vals.map(s => s.length), ...k.names.map(s => s.length));
    const per = Math.max(1, Math.floor((width + 1) / (w + 1)));
    const lines = [];
    for (let i = 0; i < vals.length; i += per) {
      lines.push(k.names.slice(i, i + per).map(s => s.padStart(w)).join(' '));
      lines.push(vals.slice(i, i + per).map(s => s.padStart(w)).join(' '));
    }
    return lines.join('\n');
  }
  function printTibble(t, width) { // character tibble (pillar 1.4 style, approximate)
    width = width || 80;
    const n = t.rows.length, shown = n > 20 ? 10 : n;
    const head = '# A tibble: ' + n + ' x ' + t.names.length;
    const cells = t.names.map((nm, j) => t.rows.slice(0, shown).map(r => r[j] === null ? '<NA>' : r[j]));
    const types = t.names.map(() => '<chr>');
    const rl = Array.from({ length: shown }, (_, i) => String(i + 1));
    const rw = Math.max(1, ...rl.map(s => s.length));
    const cw = t.names.map((nm, j) => Math.max(nm.length, 5, ...cells[j].map(s => s.length)));
    let tot = rw, j1 = 0;
    while (j1 < t.names.length && tot + 1 + cw[j1] <= width) { tot += 1 + cw[j1]; j1++; }
    const lines = [head];
    lines.push(''.padEnd(rw) + t.names.slice(0, j1).map((h, j) => ' ' + h.padEnd(cw[j])).join(''));
    lines.push('*'.padStart(rw) + types.slice(0, j1).map((h, j) => ' ' + h.padEnd(cw[j])).join('')); // '*': the tibble has row names
    for (let i = 0; i < shown; i++) lines.push(rl[i].padStart(rw) + cells.slice(0, j1).map((c, j) => ' ' + c[i].padEnd(cw[j])).join(''));
    const more = [];
    if (n > shown) more.push((n - shown) + ' more rows');
    if (j1 < t.names.length) more.push((t.names.length - j1) + ' more variable' + (t.names.length - j1 > 1 ? 's' : '') + ': ' + t.names.slice(j1).map((nm, j) => nm + ' <chr>').join(', '));
    if (more.length) lines.push('# … with ' + more.join(', and '));
    return lines.join('\n').replace(/ +$/gm, '');
  }
  /** Text of the Debug tab (renderPrint), with an extra section describing the computation */
  function debugText(o, res) {
    const L = [];
    L.push('', 'Existing patients table', '='.repeat(23));
    L.push(printDataFrame(o.existing));
    L.push('', '', 'New patients', '='.repeat(12));
    L.push(printDataFrame(o.newp));
    const pidShown = o.pidDisplay === undefined ? (o.pid || '') : o.pidDisplay;
    L.push('', 'Column with patient ID:' + (pidShown ? ' ' + pidShown : '') + ' ');
    L.push('', '', 'Available spots', '='.repeat(15));
    L.push(printNamedNumeric(o.k));
    L.push('', '', 'Computed allocation', '='.repeat(19));
    L.push('Randomization Seed:  ' + rSeedText(o.seed) + ' ');
    if (res.error) {
      const e = res.error;
      // traceback(condition): "2: <message>", then the call's elements (as.character(call)) one per line
      L.push('2: ' + e.message);
      if (e.rcall) {
        const parts = e.rcall === CALL_GTA ? ['groupTherapyAllocate', 'df', 'new', 'k', 'input$patient_id', 'val$predictability'] : [e.rcall];
        parts.forEach((p, q) => L.push((q === 0 ? '1: ' : '   ') + p));
      }
      L.push('<simpleError' + (e.rcall ? ' in ' + e.rcall : '') + ': ' + e.message + '>');
    } else L.push(printTibble(res.result.alloc));
    return L.join('\n');
  }
  function fmtImb(x) { return isNA(x) ? 'NA' : Number(x.toPrecision(7)).toString(); }
  /** Extra details of the computation (not in the original app; shown below the original Debug text) */
  function detailsText(res) {
    if (!res.result) return '';
    const I = res.result.info, L = [];
    L.push('Spots K (incl. wait): ' + I.K.names.map((nm, i) => nm + ' = ' + fmtDouble(I.K.values[i])).join(', '));
    L.push('Arm levels (incl. wait): ' + I.levels_wait.join(', '));
    L.push('Covariates: ' + I.covariates.map(c => c.name + ' [' + c.levels.join(', ') + ']').join('; '));
    if (I.new_na_strata) L.push('WARNING: ' + I.new_na_strata + ' new patient(s) have a covariate value that does not occur among the existing patients (NA stratum); they are not counted in the allocation.');
    L.push('Initial random draw sample(rep(names(K), K))[1:nnew]: ' + I.initial_draw.map(v => v === null ? 'NA' : v).join(' '));
    L.push('Strata with new patients (random order): ' + I.non_zero_rows.join(' '));
    L.push('Imbalance of the initial allocation: ' + fmtImb(I.trace[0].imb));
    I.iterations.forEach(it => L.push('  iteration ' + it.iter + ': ' + it.considered + ' exchanges considered, best imbalance ' + fmtImb(it.best_imb) + (it.best_imb < it.imb_before ? '' : ' (no improvement: stop)')));
    L.push('Local optimum imbalance: ' + fmtImb(I.final_imb) + '; trace length ' + I.trace.length + ', distinct rounded imbalance values ' + I.unique_imb.length);
    if (I.early_return) L.push('Only one imbalance value in the trace: the initial allocation is used.');
    else L.push('sampleAllocation(): imbalance class ' + I.class_sampled + ' of ' + I.unique_imb.length + ' (P = ' + fmtImb(I.p_y[I.class_sampled - 1]) + '), ' + I.class_members + ' trace entries in that class, entry ' + I.sampled_index + ' used (imbalance ' + fmtImb(I.sampled_imb) + ')');
    const hdr = I.rowVars.map(v => v.name).join(' x ') + '  |  ' + I.colLevels.join(' ');
    L.push('', 'Sampled new-patient counts per stratum (' + hdr + '):');
    const sizes = I.rowVars.map(v => v.levels.length);
    for (let r = 0; r < I.nrow; r++) {
      const lab = []; let rr = r;
      for (let q = sizes.length - 1; q >= 0; q--) { lab.unshift(I.rowVars[q].levels[rr % sizes[q]]); rr = Math.floor(rr / sizes[q]); }
      const cur = I.current_counts.data, sc = I.sampled_counts;
      L.push('  ' + lab.join(' / ') + ':  new ' + Array.from({ length: I.ncol }, (_, c) => sc[c * I.nrow + r]).join(' ') + '   (existing ' + Array.from({ length: I.ncol }, (_, c) => cur[c * I.nrow + r]).join(' ') + ')');
    }
    L.push('', 'RNG: ' + res.rng.draws + ' unif_rand() draws, sample.kind = ' + res.rng.sampleKind);
    return L.join('\n');
  }

  /** renderTable() cell text (xtable: doubles with 2 decimals, integers as is, NA as "NA") */
  function renderTableData(df) {
    const rows = [];
    for (let i = 0; i < df.nrow; i++) rows.push(df.cols.map(c => {
      if (c.type === 'factor' || c.type === 'character') { const s = asChar(c, i); return s === null ? 'NA' : s; }
      const v = c.v[i];
      if (isNA(v)) return (c.type === 'double' && typeof v === 'number') ? 'NaN' : 'NA';
      if (c.type === 'logical') return v ? 'TRUE' : 'FALSE';
      if (c.type === 'double') return isFinite(v) ? v.toFixed(2) : (v > 0 ? 'Inf' : '-Inf');
      return String(v);
    }));
    return { names: df.names, rows, numeric: df.cols.map(isNumericCol) };
  }

  const GTA = {
    RRNG, RError, LD, rsum, fround, rint, revsort, makeCollate, makeNames, fmtDouble, readCsv, parseSpots,
    factorDefault, factorWithLevels, ftableOf, imbalance, generatePatientAllocation3, sampleAllocation,
    matchPositionsPatients, groupTherapyAllocate, asCharMatrix, formatNumeric, writeCsv, downloadName, rSeedText,
    runAll, debugText, detailsText, printDataFrame, printNamedNumeric, printTibble, renderTableData, asChar, isNA
  };

  if (typeof module !== 'undefined' && module.exports) { module.exports = GTA; return; }
  if (typeof window !== 'undefined') window.GTA = GTA;
  if (typeof document === 'undefined') return;

  // ======================================================================================
  // User interface (mirrors the flexdashboard: sidebar + 4 tabs; reactive recomputation)
  // ======================================================================================
  const $ = id => document.getElementById(id);
  const S = { existing: null, newp: null, existingName: null, newName: null, k: null, seed: null, res: null, pid: '' };

  function toast(msg, type) {
    const d = document.createElement('div');
    d.className = 'toast ' + (type || 'message');
    d.textContent = msg;
    const x = document.createElement('button'); x.textContent = '×'; x.className = 'toast-x'; x.onclick = () => d.remove();
    d.appendChild(x);
    $('toasts').appendChild(d);
    setTimeout(() => d.remove(), 5000);
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]); }
  function renderTable(el, t) {
    if (!t) { el.innerHTML = ''; return; }
    const num = t.numeric || [];
    el.innerHTML = '<div class="tbl-scroll"><table class="data"><thead><tr>' + t.names.map((n, j) => '<th' + (num[j] ? ' class="num"' : '') + '>' + esc(n) + '</th>').join('') +
      '</tr></thead><tbody>' + t.rows.map(r => '<tr>' + r.map((v, j) => '<td' + (num[j] ? ' class="num"' : '') + '>' + esc(v === null ? 'NA' : v) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>';
  }
  async function readFile(file) { return new Uint8Array(await file.arrayBuffer()); }
  function collation() { return $('collation').value; }
  function sampleKind() { return $('samplekind').value; }

  async function onExisting() {
    const f = $('existing_patients').files[0];
    if (!f) return;
    S.existingName = f.name; S.existingData = await readFile(f);
    loadExisting(true);
  }
  function loadExisting(updateSpots) {
    try { S.existing = readCsv(S.existingData, { collation: collation() }); }
    catch (e) { S.existing = null; toast('Error reading the file with existing patients: ' + e.message, 'error'); }
    if (S.existing && updateSpots && S.existing.names.indexOf('arm') >= 0) {
      // updateTextAreaInput(..., paste(paste(unique(tmp$arm), " = 0"), collapse = ", "))
      const arm = S.existing.cols[S.existing.names.indexOf('arm')];
      const vals = asCharVecUI(arm);
      const u = []; vals.forEach(v => { const s = v === null ? 'NA' : v; if (u.indexOf(s) < 0) u.push(s); });
      $('spots_k').value = u.map(s => s + '  = 0').join(', ');
      parseK();
    }
    renderTable($('tblExisting'), S.existing ? renderTableData(S.existing) : null);
    recompute();
  }
  function asCharVecUI(c) { const n = c.type === 'factor' ? c.codes.length : c.v.length; return Array.from({ length: n }, (_, i) => asChar(c, i)); }
  async function onNew() {
    const f = $('new_patients').files[0];
    if (!f) return;
    S.newName = f.name; S.newData = await readFile(f);
    loadNew(true);
  }
  function loadNew(updateChoices) {
    try { S.newp = readCsv(S.newData, { collation: collation() }); }
    catch (e) { S.newp = null; toast('Error reading the file with new patients: ' + e.message, 'error'); }
    if (S.newp && updateChoices) {
      const sel = $('patient_id');
      sel.innerHTML = '';
      S.newp.names.forEach(nm => { const o = document.createElement('option'); o.value = nm; o.textContent = nm; sel.appendChild(o); });
      const o = document.createElement('option'); o.value = '\u0000none'; o.textContent = '(none: use row numbers; not in the original app)'; sel.appendChild(o);
      sel.value = S.newp.names[0] || '';
    }
    renderTable($('tblNew'), S.newp ? renderTableData(S.newp) : null);
    recompute();
  }
  function parseK() {
    const r = parseSpots($('spots_k').value);
    if (r.empty) return;
    if (!r.ok) { toast(r.error + (r.unsupported ? ' (only "name = number" pairs are supported)' : ''), 'error'); return; }
    S.k = r.k;
  }
  function currentPid() { const v = $('patient_id').value; return v === '\u0000none' ? '' : v; }
  function recompute() {
    const seedTxt = $('RandomSeed').value;
    if (seedTxt !== '' && !isNaN(Number(seedTxt))) S.seed = Number(seedTxt); // req(input$RandomSeed)
    const ready = S.existing && S.newp && S.k;
    $('downloadFile').disabled = true;
    if (!ready) { renderTable($('tblAlloc'), null); $('debug').textContent = ''; $('debugExtra').textContent = ''; S.res = null; return; }
    const o = { existing: S.existing, newp: S.newp, k: S.k, pid: currentPid(), pidDisplay: S.newp ? currentPid() : '', seed: S.seed, sampleKind: sampleKind(), collation: collation(), predictability: 0.8 };
    let res;
    try { res = runAll(o); } catch (e) { res = { error: new RError('internal error: ' + e.message), rng: new RRNG(null) }; console.error(e); }
    S.res = res;
    if (res.error) {
      $('tblAlloc').innerHTML = '<p class="err">Error: ' + esc(res.error.message) + '</p>';
    } else {
      renderTable($('tblAlloc'), res.result.alloc);
      $('downloadFile').disabled = false;
    }
    $('debug').textContent = debugText(o, res);
    $('debugExtra').textContent = detailsText(res);
  }
  function today() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function download() {
    if (!S.res || !S.res.result) return;
    const blob = new Blob([S.res.download], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = downloadName($('spots_k').value, S.seed, today());
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  function initUI() {
    const now = new Date();
    $('RandomSeed').value = String(now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate()); // as.integer(gsub("\\D", "", Sys.Date()))
    $('existing_patients').addEventListener('change', onExisting);
    $('new_patients').addEventListener('change', onNew);
    $('patient_id').addEventListener('change', recompute);
    $('RandomSeed').addEventListener('input', recompute);
    $('spots_k').addEventListener('input', () => { parseK(); recompute(); });
    $('samplekind').addEventListener('change', recompute);
    $('collation').addEventListener('change', () => { if (S.existingData) loadExisting(false); if (S.newData) loadNew(false); });
    $('downloadFile').addEventListener('click', download);
    document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => {
      document.querySelectorAll('.tabs button').forEach(x => x.classList.toggle('active', x === b));
      document.querySelectorAll('.tabpane').forEach(p => p.classList.toggle('active', p.id === b.dataset.tab));
    }));
    parseK();
    recompute();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initUI); else initUI();
})();
