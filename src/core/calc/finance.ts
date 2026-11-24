/**
 * Cálculos financeiros determinísticos. Cada função devolve o resultado e os passos
 * (o "raciocínio" mostrado ao usuário). Valores monetários em Dec, arredondados a 2 casas só na exibição.
 */
import { CalcError, Dec } from './decimal.ts';

export interface CalcResult {
  title: string;
  /** Valores principais, já em Dec (para registro no financeiro). */
  values: Record<string, Dec>;
  steps: string[];
}

const d = (x: number | string | Dec) => Dec.of(x);
const brl = (x: Dec) => x.toBRL();
const pct = (x: Dec) => `${x.toBR()}%`;

function positive(x: Dec, name: string) {
  if (x.cmp(Dec.ZERO) < 0) throw new CalcError(`${name} não pode ser negativo.`);
}

/** Lucro de compra e venda, com comissão opcional sobre o lucro. */
export function profit(cost: Dec, sale: Dec, commissionPct?: Dec): CalcResult {
  positive(cost, 'Custo');
  positive(sale, 'Venda');
  const p = sale.sub(cost);
  const steps = [`Lucro bruto = venda − custo = ${brl(sale)} − ${brl(cost)} = ${brl(p)}`];
  const values: Record<string, Dec> = { lucro: p };
  if (!cost.isZero()) {
    const markup = p.div(cost).mul(Dec.HUNDRED);
    steps.push(`Markup = lucro ÷ custo = ${pct(markup.round(2))}`);
    values.markup_pct = markup;
  }
  if (!sale.isZero()) {
    const margin = p.div(sale).mul(Dec.HUNDRED);
    steps.push(`Margem = lucro ÷ venda = ${pct(margin.round(2))}`);
    values.margem_pct = margin;
  }
  if (commissionPct) {
    const c = p.mul(commissionPct.pct());
    steps.push(`Comissão de ${pct(commissionPct)} sobre o lucro = ${brl(p)} × ${pct(commissionPct)} = ${brl(c)}`);
    values.comissao = c;
  }
  return { title: 'Lucro', values, steps };
}

export function commission(base: Dec, ratePct: Dec): CalcResult {
  const c = base.mul(ratePct.pct());
  return { title: 'Comissão', values: { comissao: c }, steps: [`Comissão = ${brl(base)} × ${pct(ratePct)} = ${brl(c)}`] };
}

export function discount(value: Dec, ratePct: Dec): CalcResult {
  const off = value.mul(ratePct.pct());
  const final = value.sub(off);
  return { title: 'Desconto', values: { desconto: off, final }, steps: [`Desconto = ${brl(value)} × ${pct(ratePct)} = ${brl(off)}`, `Valor final = ${brl(value)} − ${brl(off)} = ${brl(final)}`] };
}

export function increase(value: Dec, ratePct: Dec): CalcResult {
  const add = value.mul(ratePct.pct());
  const final = value.add(add);
  return { title: 'Acréscimo', values: { acrescimo: add, final }, steps: [`Acréscimo = ${brl(value)} × ${pct(ratePct)} = ${brl(add)}`, `Valor final = ${brl(value)} + ${brl(add)} = ${brl(final)}`] };
}

export function percentChange(from: Dec, to: Dec): CalcResult {
  if (from.isZero()) throw new CalcError('O valor inicial não pode ser zero.');
  const ch = to.sub(from).div(from).mul(Dec.HUNDRED);
  return { title: 'Variação percentual', values: { variacao_pct: ch }, steps: [`Variação = (${to.toBR()} − ${from.toBR()}) ÷ ${from.toBR()} = ${pct(ch.round(2))}`] };
}

/** Regra de três simples: se a → b, então c → x. */
export function ruleOfThree(a: Dec, b: Dec, c: Dec): CalcResult {
  const x = b.mul(c).div(a);
  return { title: 'Regra de três', values: { x }, steps: [`${a.toBR()} → ${b.toBR()}`, `${c.toBR()} → x`, `x = ${b.toBR()} × ${c.toBR()} ÷ ${a.toBR()} = ${x.toBR()}`] };
}

export function simpleInterest(principal: Dec, ratePct: Dec, periods: number): CalcResult {
  const j = principal.mul(ratePct.pct()).mul(d(periods));
  const total = principal.add(j);
  return { title: 'Juros simples', values: { juros: j, montante: total }, steps: [`Juros = ${brl(principal)} × ${pct(ratePct)} × ${periods} = ${brl(j)}`, `Montante = ${brl(total)}`] };
}

/** Juros compostos com aporte opcional por período (aporte no fim do período). */
export function compoundInterest(principal: Dec, ratePct: Dec, periods: number, contribution: Dec = Dec.ZERO): CalcResult {
  const i = ratePct.pct();
  const f = Dec.ONE.add(i).pow(periods);
  let total = principal.mul(f);
  const steps = [`Montante do capital = ${brl(principal)} × (1 + ${pct(ratePct)})^${periods} = ${brl(total)}`];
  if (!contribution.isZero()) {
    const fv = i.isZero() ? contribution.mul(d(periods)) : contribution.mul(f.sub(Dec.ONE).div(i));
    steps.push(`Aportes de ${brl(contribution)} por ${periods} períodos = ${brl(fv)}`);
    total = total.add(fv);
  }
  const invested = principal.add(contribution.mul(d(periods)));
  const interest = total.sub(invested);
  steps.push(`Total investido = ${brl(invested)} · Juros = ${brl(interest)} · Montante = ${brl(total)}`);
  return { title: 'Juros compostos', values: { montante: total, investido: invested, juros: interest }, steps };
}

/** Parcelamento pela Tabela Price (parcelas iguais). */
export function installments(principal: Dec, ratePct: Dec, n: number): CalcResult {
  if (!Number.isInteger(n) || n < 1 || n > 600) throw new CalcError('Número de parcelas deve ser entre 1 e 600.');
  const i = ratePct.pct();
  const pmt = i.isZero() ? principal.div(d(n)) : principal.mul(i).div(Dec.ONE.sub(Dec.ONE.add(i).pow(-n)));
  const total = pmt.mul(d(n));
  const interest = total.sub(principal);
  return {
    title: 'Parcelamento',
    values: { parcela: pmt, total, juros: interest },
    steps: [
      i.isZero() ? `Parcela = ${brl(principal)} ÷ ${n} = ${brl(pmt)}` : `Parcela (Price) = ${brl(principal)} × i ÷ (1 − (1 + i)^−${n}), i = ${pct(ratePct)} → ${brl(pmt)}`,
      `Total pago = ${n} × ${brl(pmt.round(2))} = ${brl(total)} · Juros = ${brl(interest)}`,
    ],
  };
}

export function statistics(values: Dec[]): CalcResult {
  if (!values.length) throw new CalcError('Informe ao menos um valor.');
  const sorted = [...values].sort((a, b) => a.cmp(b));
  const sum = values.reduce((a, b) => a.add(b), Dec.ZERO);
  const mean = sum.div(d(values.length));
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid] : sorted[mid - 1].add(sorted[mid]).div(d(2));
  const variance = values.reduce((a, v) => a.add(v.sub(mean).pow(2)), Dec.ZERO).div(d(values.length));
  const sd = variance.sqrt();
  return {
    title: 'Estatísticas',
    values: { soma: sum, media: mean, mediana: median, minimo: sorted[0], maximo: sorted[sorted.length - 1], desvio_padrao: sd },
    steps: [`n = ${values.length} · soma = ${sum.toBR()} · média = ${mean.toBR(4)} · mediana = ${median.toBR()}`, `mínimo = ${sorted[0].toBR()} · máximo = ${sorted[sorted.length - 1].toBR()} · desvio-padrão = ${sd.toBR(4)}`],
  };
}
