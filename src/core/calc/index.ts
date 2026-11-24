/**
 * JARVIS Calculation Engine — entrada validada, execução e reconhecimento local de pedidos de cálculo.
 * Sem dependência do agente, para poder ser usado pelo interpretador local e pela ferramenta.
 */
import { z } from 'zod';
import { Dec } from './decimal.ts';
import { evaluate, normalizeExpression, parseNumberBR } from './expr.ts';
import * as F from './finance.ts';

export { CalcError, Dec } from './decimal.ts';
export type { CalcResult } from './finance.ts';

const Num = z.union([z.number(), z.string().max(40)]).describe('Número (aceita "1.234,56")');
const n = (x: number | string) => (typeof x === 'number' ? Dec.of(x) : parseNumberBR(x.replace(/r\$\s*/i, '').replace('%', '')));

export const CalcInput = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('expression'), expression: z.string().min(1).max(300).describe('Ex.: "(1500*12) - 15% de 200"') }),
  z.object({ operation: z.literal('profit'), cost: Num, sale: Num, commission_percent: Num.optional() }),
  z.object({ operation: z.literal('commission'), base: Num, percent: Num }),
  z.object({ operation: z.literal('discount'), value: Num, percent: Num }),
  z.object({ operation: z.literal('increase'), value: Num, percent: Num }),
  z.object({ operation: z.literal('percent_change'), from: Num, to: Num }),
  z.object({ operation: z.literal('rule_of_three'), a: Num, b: Num, c: Num }),
  z.object({ operation: z.literal('simple_interest'), principal: Num, rate_percent: Num, periods: z.number().int().min(1).max(1200) }),
  z.object({ operation: z.literal('compound_interest'), principal: Num, rate_percent: Num, periods: z.number().int().min(1).max(1200), contribution: Num.optional() }),
  z.object({ operation: z.literal('installments'), principal: Num, rate_percent: Num, count: z.number().int().min(1).max(600) }),
  z.object({ operation: z.literal('statistics'), values: z.array(Num).min(1).max(1000) }),
]);
export type CalcInputT = z.infer<typeof CalcInput>;

export function runCalc(i: CalcInputT): F.CalcResult {
  switch (i.operation) {
    case 'expression': {
      const v = evaluate(i.expression);
      return { title: 'Cálculo', values: { resultado: v }, steps: [`${normalizeExpression(i.expression)} = ${v.toBR()}`] };
    }
    case 'profit': return F.profit(n(i.cost), n(i.sale), i.commission_percent != null ? n(i.commission_percent) : undefined);
    case 'commission': return F.commission(n(i.base), n(i.percent));
    case 'discount': return F.discount(n(i.value), n(i.percent));
    case 'increase': return F.increase(n(i.value), n(i.percent));
    case 'percent_change': return F.percentChange(n(i.from), n(i.to));
    case 'rule_of_three': return F.ruleOfThree(n(i.a), n(i.b), n(i.c));
    case 'simple_interest': return F.simpleInterest(n(i.principal), n(i.rate_percent), i.periods);
    case 'compound_interest': return F.compoundInterest(n(i.principal), n(i.rate_percent), i.periods, i.contribution != null ? n(i.contribution) : undefined);
    case 'installments': return F.installments(n(i.principal), n(i.rate_percent), i.count);
    case 'statistics': return F.statistics(i.values.map(n));
  }
}

/* ------------- Reconhecimento local (sem IA) de pedidos de cálculo ------------- */

const NUM = String.raw`(?:r\$\s*)?(\d+(?:[.,]\d+)*)`;

/** Devolve a entrada da ferramenta `calculate` quando o pedido é claramente um cálculo. */
export function parseCalcRequest(text: string): CalcInputT | null {
  const s = text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/^\s*jarvis[\s,]*/, '').trim();

  // "comprei ... por R$ 200, vendi por R$ 350 e recebo 30% sobre o lucro"
  const buy = new RegExp(`(?:comprei|paguei|custou|custo)[^\\d]*?${NUM}`).exec(s);
  const sell = new RegExp(`(?:vendi|vendo|venda|vender)[^\\d]*?${NUM}`).exec(s);
  if (buy && sell) {
    const com = new RegExp(`(\\d+(?:[.,]\\d+)*)\\s*%\\s*(?:de\\s+comissao\\s+)?(?:sobre|do|de)\\s+(?:o\\s+)?lucro`).exec(s);
    return { operation: 'profit', cost: buy[1], sale: sell[1], ...(com ? { commission_percent: com[1] } : {}) };
  }

  // "x% de desconto em 200" / "200 com 10% de desconto"
  const disc = new RegExp(`${NUM}\\s+com\\s+(\\d+(?:[.,]\\d+)*)\\s*%\\s+de\\s+desconto|(\\d+(?:[.,]\\d+)*)\\s*%\\s+de\\s+desconto\\s+(?:em|sobre|de)\\s+${NUM}`).exec(s);
  if (disc) return disc[1] ? { operation: 'discount', value: disc[1], percent: disc[2] } : { operation: 'discount', value: disc[4], percent: disc[3] };

  // Expressão pura: "quanto é 15% de 200", "calcule (1500*12)-300", "2+2"
  const m = /^(?:quanto\s+(?:e|da|fica|vale)|calcule|calcula|calcular|resolva|conta:?)\s+(.+?)\??$/.exec(s) ?? (/^[\d(][\d\s.,+\-*/^%()x]*$/.test(s) && /[+\-*/^%x]/.test(s) ? [s, s] : null);
  if (m) {
    try {
      evaluate(m[1]);
      return { operation: 'expression', expression: m[1] };
    } catch {
      return null;
    }
  }
  return null;
}
