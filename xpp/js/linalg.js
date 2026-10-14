// Small dense linear algebra: LU with partial pivoting, determinant,
// eigenvalues of real matrices (Hessenberg reduction + Francis QR, after
// Numerical Recipes elmhes/hqr), eigenvectors by inverse iteration.

export function matrix(n, m = n) {
  const A = new Array(n);
  for (let i = 0; i < n; i++) A[i] = new Float64Array(m);
  return A;
}
export function copyMatrix(A) { return A.map((r) => Float64Array.from(r)); }

/** LU decomposition in place (A is array of rows). Returns {A, piv, sign, singular}. */
export function lu(A) {
  const n = A.length;
  const piv = new Int32Array(n);
  let sign = 1;
  let singular = false;
  for (let i = 0; i < n; i++) piv[i] = i;
  for (let k = 0; k < n; k++) {
    let p = k, max = Math.abs(A[k][k]);
    for (let i = k + 1; i < n; i++) { const v = Math.abs(A[i][k]); if (v > max) { max = v; p = i; } }
    if (p !== k) { const t = A[p]; A[p] = A[k]; A[k] = t; const q = piv[p]; piv[p] = piv[k]; piv[k] = q; sign = -sign; }
    const d = A[k][k];
    if (d === 0 || !Number.isFinite(d)) { singular = true; continue; }
    const rk = A[k];
    for (let i = k + 1; i < n; i++) {
      const ri = A[i];
      const f = ri[k] / d;
      ri[k] = f;
      if (f !== 0) for (let j = k + 1; j < n; j++) ri[j] -= f * rk[j];
    }
  }
  return { A, piv, sign, singular };
}

/** Solves using a decomposition from lu(). Zero pivots are replaced by a tiny value. */
export function luSolve(D, b) {
  const { A, piv } = D;
  const n = A.length;
  const x = new Float64Array(n);
  for (let i = 0; i < n; i++) x[i] = b[piv[i]];
  for (let i = 0; i < n; i++) { const r = A[i]; let s = x[i]; for (let j = 0; j < i; j++) s -= r[j] * x[j]; x[i] = s; }
  for (let i = n - 1; i >= 0; i--) {
    const r = A[i];
    let s = x[i];
    for (let j = i + 1; j < n; j++) s -= r[j] * x[j];
    let d = r[i];
    if (d === 0) d = 1e-300;
    x[i] = s / d;
  }
  return x;
}
export function solve(A, b) { return luSolve(lu(copyMatrix(A)), b); }
export function det(D) {
  let d = D.sign;
  for (let i = 0; i < D.A.length; i++) d *= D.A[i][i];
  return d;
}

/** Eigenvalues of a real square matrix. Returns [{re, im}] sorted by descending real part. */
export function eigenvalues(M) {
  const n = M.length;
  if (n === 0) return [];
  if (n === 1) return [{ re: M[0][0], im: 0 }];
  // 1-based copy
  const a = [];
  for (let i = 0; i <= n; i++) a.push(new Float64Array(n + 1));
  for (let i = 1; i <= n; i++) for (let j = 1; j <= n; j++) a[i][j] = M[i - 1][j - 1];
  for (let i = 1; i <= n; i++) for (let j = 1; j <= n; j++) if (!Number.isFinite(a[i][j])) return new Array(n).fill(0).map(() => ({ re: NaN, im: NaN }));
  balance(a, n);
  elmhes(a, n);
  for (let i = 3; i <= n; i++) for (let j = 1; j <= i - 2; j++) a[i][j] = 0;
  const wr = new Float64Array(n + 1), wi = new Float64Array(n + 1);
  if (!hqr(a, n, wr, wi)) return new Array(n).fill(0).map(() => ({ re: NaN, im: NaN }));
  const out = [];
  for (let i = 1; i <= n; i++) out.push({ re: wr[i], im: wi[i] });
  out.sort((p, q) => q.re - p.re || q.im - p.im);
  return out;
}

function balance(a, n) {
  const RADIX = 2, sqrdx = RADIX * RADIX;
  let last = 0;
  while (last === 0) {
    last = 1;
    for (let i = 1; i <= n; i++) {
      let r = 0, c = 0;
      for (let j = 1; j <= n; j++) if (j !== i) { c += Math.abs(a[j][i]); r += Math.abs(a[i][j]); }
      if (c && r) {
        let g = r / RADIX, f = 1;
        const s = c + r;
        while (c < g) { f *= RADIX; c *= sqrdx; }
        g = r * RADIX;
        while (c > g) { f /= RADIX; c /= sqrdx; }
        if ((c + r) / f < 0.95 * s) {
          last = 0;
          g = 1 / f;
          for (let j = 1; j <= n; j++) a[i][j] *= g;
          for (let j = 1; j <= n; j++) a[j][i] *= f;
        }
      }
    }
  }
}

function elmhes(a, n) {
  for (let m = 2; m < n; m++) {
    let x = 0, i = m;
    for (let j = m; j <= n; j++) {
      if (Math.abs(a[j][m - 1]) > Math.abs(x)) { x = a[j][m - 1]; i = j; }
    }
    if (i !== m) {
      for (let j = m - 1; j <= n; j++) { const t = a[i][j]; a[i][j] = a[m][j]; a[m][j] = t; }
      for (let j = 1; j <= n; j++) { const t = a[j][i]; a[j][i] = a[j][m]; a[j][m] = t; }
    }
    if (x) {
      for (i = m + 1; i <= n; i++) {
        let y = a[i][m - 1];
        if (y !== 0) {
          y /= x;
          a[i][m - 1] = y;
          for (let j = m; j <= n; j++) a[i][j] -= y * a[m][j];
          for (let j = 1; j <= n; j++) a[j][m] += y * a[j][i];
        }
      }
    }
  }
}

const SIGN = (a, b) => (b >= 0 ? Math.abs(a) : -Math.abs(a));

function hqr(a, n, wr, wi) {
  let nn, m, l, k, j, its, i, mmin;
  let z = 0, y, x, w, v, u, t, s, r = 0, q = 0, p = 0, anorm = 0;
  for (i = 1; i <= n; i++) for (j = Math.max(i - 1, 1); j <= n; j++) anorm += Math.abs(a[i][j]);
  nn = n;
  t = 0;
  while (nn >= 1) {
    its = 0;
    do {
      for (l = nn; l >= 2; l--) {
        s = Math.abs(a[l - 1][l - 1]) + Math.abs(a[l][l]);
        if (s === 0) s = anorm;
        if (Math.abs(a[l][l - 1]) + s === s) { a[l][l - 1] = 0; break; }
      }
      x = a[nn][nn];
      if (l === nn) {
        wr[nn] = x + t;
        wi[nn--] = 0;
      } else {
        y = a[nn - 1][nn - 1];
        w = a[nn][nn - 1] * a[nn - 1][nn];
        if (l === nn - 1) {
          p = 0.5 * (y - x);
          q = p * p + w;
          z = Math.sqrt(Math.abs(q));
          x += t;
          if (q >= 0) {
            z = p + SIGN(z, p);
            wr[nn - 1] = wr[nn] = x + z;
            if (z) wr[nn] = x - w / z;
            wi[nn - 1] = wi[nn] = 0;
          } else {
            wr[nn - 1] = wr[nn] = x + p;
            wi[nn - 1] = -(wi[nn] = z);
          }
          nn -= 2;
        } else {
          if (its === 60) return false;
          if (its === 10 || its === 20 || its === 40) {
            t += x;
            for (i = 1; i <= nn; i++) a[i][i] -= x;
            s = Math.abs(a[nn][nn - 1]) + Math.abs(a[nn - 1][nn - 2]);
            y = x = 0.75 * s;
            w = -0.4375 * s * s;
          }
          ++its;
          for (m = nn - 2; m >= l; m--) {
            z = a[m][m];
            r = x - z;
            s = y - z;
            p = (r * s - w) / a[m + 1][m] + a[m][m + 1];
            q = a[m + 1][m + 1] - z - r - s;
            r = a[m + 2][m + 1];
            s = Math.abs(p) + Math.abs(q) + Math.abs(r);
            p /= s; q /= s; r /= s;
            if (m === l) break;
            u = Math.abs(a[m][m - 1]) * (Math.abs(q) + Math.abs(r));
            v = Math.abs(p) * (Math.abs(a[m - 1][m - 1]) + Math.abs(z) + Math.abs(a[m + 1][m + 1]));
            if (u + v === v) break;
          }
          for (i = m + 2; i <= nn; i++) {
            a[i][i - 2] = 0;
            if (i !== m + 2) a[i][i - 3] = 0;
          }
          for (k = m; k <= nn - 1; k++) {
            if (k !== m) {
              p = a[k][k - 1];
              q = a[k + 1][k - 1];
              r = 0;
              if (k !== nn - 1) r = a[k + 2][k - 1];
              if ((x = Math.abs(p) + Math.abs(q) + Math.abs(r)) !== 0) { p /= x; q /= x; r /= x; }
            }
            if ((s = SIGN(Math.sqrt(p * p + q * q + r * r), p)) !== 0) {
              if (k === m) {
                if (l !== m) a[k][k - 1] = -a[k][k - 1];
              } else a[k][k - 1] = -s * x;
              p += s;
              x = p / s;
              y = q / s;
              z = r / s;
              q /= p;
              r /= p;
              for (j = k; j <= nn; j++) {
                p = a[k][j] + q * a[k + 1][j];
                if (k !== nn - 1) { p += r * a[k + 2][j]; a[k + 2][j] -= p * z; }
                a[k + 1][j] -= p * y;
                a[k][j] -= p * x;
              }
              mmin = nn < k + 3 ? nn : k + 3;
              for (i = l; i <= mmin; i++) {
                p = x * a[i][k] + y * a[i][k + 1];
                if (k !== nn - 1) { p += z * a[i][k + 2]; a[i][k + 2] -= p * r; }
                a[i][k + 1] -= p * q;
                a[i][k] -= p;
              }
            }
          }
        }
      }
    } while (l < nn - 1);
  }
  return true;
}

/** Real eigenvector for real eigenvalue lambda (inverse iteration). Normalized, unit length. */
export function eigenvector(M, lambda) {
  const n = M.length;
  const scale = 1 + Math.abs(lambda) + M.reduce((s, r) => s + r.reduce((a, b) => a + Math.abs(b), 0), 0) / n;
  const A = copyMatrix(M);
  const shift = lambda + 1e-9 * scale;
  for (let i = 0; i < n; i++) A[i][i] -= shift;
  const D = lu(A);
  let v = new Float64Array(n);
  for (let i = 0; i < n; i++) v[i] = 1 / Math.sqrt(n) + 0.1 * Math.sin(i + 1);
  for (let it = 0; it < 4; it++) {
    const w = luSolve(D, v);
    let nr = 0;
    for (let i = 0; i < n; i++) nr += w[i] * w[i];
    nr = Math.sqrt(nr);
    if (!(nr > 0) || !Number.isFinite(nr)) break;
    for (let i = 0; i < n; i++) v[i] = w[i] / nr;
  }
  // fix sign: largest component positive
  let k = 0;
  for (let i = 1; i < n; i++) if (Math.abs(v[i]) > Math.abs(v[k])) k = i;
  if (v[k] < 0) v = v.map((c) => -c);
  return v;
}

export function norm(v) { let s = 0; for (let i = 0; i < v.length; i++) s += v[i] * v[i]; return Math.sqrt(s); }
export function dot(a, b) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }
