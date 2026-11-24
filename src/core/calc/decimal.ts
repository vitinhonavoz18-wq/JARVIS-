/**
 * Decimal exato com BigInt (ponto fixo, 18 casas). Sem dependências e sem float para dinheiro.
 */
const SCALE = 18n;
const ONE = 10n ** SCALE;

export class Dec {
  private constructor(readonly v: bigint) {}

  static of(x: string | number | bigint | Dec): Dec {
    if (x instanceof Dec) return x;
    if (typeof x === 'bigint') return new Dec(x * ONE);
    const s = typeof x === 'number' ? numberToPlain(x) : x.trim();
    const m = /^([+-])?(\d*)(?:\.(\d*))?$/.exec(s);
    if (!m || (!m[2] && !m[3])) throw new CalcError(`Número inválido: ${s}`);
    const frac = (m[3] ?? '').slice(0, Number(SCALE)).padEnd(Number(SCALE), '0');
    const v = BigInt(m[2] || '0') * ONE + BigInt(frac || '0');
    return new Dec(m[1] === '-' ? -v : v);
  }

  static readonly ZERO = new Dec(0n);
  static readonly ONE = new Dec(ONE);
  static readonly HUNDRED = new Dec(100n * ONE);

  add(o: Dec) { return new Dec(this.v + o.v); }
  sub(o: Dec) { return new Dec(this.v - o.v); }
  mul(o: Dec) { return new Dec(divRound(this.v * o.v, ONE)); }
  div(o: Dec) {
    if (o.v === 0n) throw new CalcError('Divisão por zero.');
    return new Dec(divRound(this.v * ONE, o.v));
  }
  neg() { return new Dec(-this.v); }
  abs() { return this.v < 0n ? this.neg() : this; }
  pct() { return this.div(Dec.HUNDRED); }
  cmp(o: Dec) { return this.v < o.v ? -1 : this.v > o.v ? 1 : 0; }
  isZero() { return this.v === 0n; }
  isInteger() { return this.v % ONE === 0n; }

  /** Potência com expoente inteiro (até ±1000). */
  pow(n: number): Dec {
    if (!Number.isInteger(n) || Math.abs(n) > 1000) throw new CalcError('Expoente deve ser inteiro entre -1000 e 1000.');
    let result: Dec = Dec.ONE;
    let base: Dec = n < 0 ? Dec.ONE.div(this) : this;
    let e = Math.abs(n);
    while (e > 0) {
      if (e & 1) result = result.mul(base);
      base = base.mul(base);
      e >>= 1;
    }
    return result;
  }

  /** Raiz quadrada (Newton em inteiros). */
  sqrt(): Dec {
    if (this.v < 0n) throw new CalcError('Raiz de número negativo.');
    const n = this.v * ONE;
    if (n === 0n) return Dec.ZERO;
    let x = BigInt(Math.floor(Math.sqrt(Number(n)))) || 1n;
    for (let i = 0; i < 200; i++) {
      const y = (x + n / x) / 2n;
      if (y === x || y === x + 1n || y === x - 1n) { x = y; break; }
      x = y;
    }
    while (x * x > n) x -= 1n;
    return new Dec(x);
  }

  /** Arredonda para `places` casas (meio para cima, como no comércio). */
  round(places = 2): Dec {
    const f = 10n ** (SCALE - BigInt(places));
    return new Dec(divRound(this.v, f) * f);
  }

  toNumber() { return Number(this.toString(12)); }

  /** Representação com ponto decimal, sem zeros à direita. */
  toString(maxPlaces = 10): string {
    const r = this.round(maxPlaces).v;
    const neg = r < 0n;
    const a = neg ? -r : r;
    const int = a / ONE;
    const frac = (a % ONE).toString().padStart(Number(SCALE), '0').slice(0, maxPlaces).replace(/0+$/, '');
    return `${neg && (int > 0n || frac) ? '-' : ''}${int}${frac ? `.${frac}` : ''}`;
  }

  /** Formato brasileiro: 1.234,56 */
  toBR(places?: number): string {
    const s = places == null ? this.toString() : fixed(this.round(places), places);
    const [i, f] = s.split('.');
    const neg = i.startsWith('-');
    const digits = (neg ? i.slice(1) : i).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return `${neg ? '-' : ''}${digits}${f ? `,${f}` : ''}`;
  }

  /** Moeda: R$ 1.234,56 */
  toBRL(): string {
    const s = this.toBR(2);
    return s.startsWith('-') ? `-R$ ${s.slice(1)}` : `R$ ${s}`;
  }
}

export class CalcError extends Error {}

function fixed(d: Dec, places: number) {
  const s = d.toString(places);
  const [i, f = ''] = s.split('.');
  return places ? `${i}.${f.padEnd(places, '0')}` : i;
}

function divRound(a: bigint, b: bigint): bigint {
  const q = a / b;
  const r = a % b;
  if (r === 0n) return q;
  const twice = (r < 0n ? -r : r) * 2n;
  const bAbs = b < 0n ? -b : b;
  if (twice >= bAbs) return q + ((a < 0n) !== (b < 0n) ? -1n : 1n);
  return q;
}

function numberToPlain(x: number): string {
  if (!Number.isFinite(x)) throw new CalcError('Número inválido.');
  return x.toLocaleString('en-US', { useGrouping: false, maximumFractionDigits: 18 });
}
