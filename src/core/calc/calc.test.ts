import { describe, it, expect } from 'vitest';
import { Dec, parseCalcRequest, runCalc } from './index.ts';
import { evaluate } from './expr.ts';

const ev = (s: string) => evaluate(s).toString();

describe('decimal exato', () => {
  it('não sofre erro de ponto flutuante', () => {
    expect(Dec.of('0.1').add(Dec.of('0.2')).toString()).toBe('0.3');
    expect(ev('0,1 + 0,2')).toBe('0.3');
    expect(ev('19,99 * 3')).toBe('59.97');
  });
  it('formata em reais', () => {
    expect(Dec.of('1234.5').toBRL()).toBe('R$ 1.234,50');
    expect(Dec.of('-45').toBRL()).toBe('-R$ 45,00');
  });
});

describe('parser seguro de expressões', () => {
  it.each([
    ['2 + 2 * 3', '8'],
    ['(2 + 2) * 3', '12'],
    ['2^10', '1024'],
    ['15% de 200', '30'],
    ['1.234,56 + 0,44', '1235'],
    ['10 dividido por 4', '2.5'],
    ['3 vezes 7', '21'],
    ['raiz quadrada de 144', '12'],
    ['-5 + 3', '-2'],
    ['max(3; 9; 4)', '9'],
    ['2x3', '6'],
  ])('%s = %s', (e, r) => expect(ev(e)).toBe(r));

  it.each([
    'constructor', 'process.exit()', 'alert(1)', '2 +', '(2', '1/0', 'a'.repeat(400), '2^0.5',
  ])('rejeita “%s” com erro controlado', (e) => expect(() => evaluate(e)).toThrow());
});

describe('cálculos financeiros', () => {
  it('exemplo da bateria: lucro R$ 150 e comissão de 30% = R$ 45', () => {
    const r = runCalc({ operation: 'profit', cost: '200', sale: '350', commission_percent: '30' });
    expect(r.values.lucro.toString()).toBe('150');
    expect(r.values.comissao.toString()).toBe('45');
    expect(r.steps.join('\n')).toContain('R$ 45,00');
  });
  it('parcelamento Price: R$ 1.000 a 2% em 12x ≈ R$ 94,56', () => {
    expect(runCalc({ operation: 'installments', principal: 1000, rate_percent: 2, count: 12 }).values.parcela.round(2).toString()).toBe('94.56');
  });
  it('juros compostos: R$ 1.000 a 1% por 12 meses = R$ 1.126,83', () => {
    expect(runCalc({ operation: 'compound_interest', principal: 1000, rate_percent: 1, periods: 12 }).values.montante.round(2).toString()).toBe('1126.83');
  });
  it('juros simples, desconto, acréscimo, regra de três e variação', () => {
    expect(runCalc({ operation: 'simple_interest', principal: 1000, rate_percent: 2, periods: 5 }).values.juros.toString()).toBe('100');
    expect(runCalc({ operation: 'discount', value: '250', percent: '10' }).values.final.toString()).toBe('225');
    expect(runCalc({ operation: 'increase', value: '250', percent: '10' }).values.final.toString()).toBe('275');
    expect(runCalc({ operation: 'rule_of_three', a: 2, b: 10, c: 7 }).values.x.toString()).toBe('35');
    expect(runCalc({ operation: 'percent_change', from: 200, to: 250 }).values.variacao_pct.toString()).toBe('25');
  });
  it('estatísticas', () => {
    const v = runCalc({ operation: 'statistics', values: [2, 4, 4, 4, 5, 5, 7, 9] }).values;
    expect(v.media.toString()).toBe('5');
    expect(v.mediana.toString()).toBe('4.5');
    expect(v.desvio_padrao.toString()).toBe('2');
  });
});

describe('reconhecimento local de pedidos de cálculo', () => {
  it('lê o pedido da bateria em linguagem natural', () => {
    expect(parseCalcRequest('Jarvis, comprei uma bateria por R$ 200, vendi por R$ 350 e recebo 30% sobre o lucro. Quanto ganhei?')).toEqual({ operation: 'profit', cost: '200', sale: '350', commission_percent: '30' });
  });
  it('reconhece expressões e descontos', () => {
    expect(parseCalcRequest('quanto é 15% de 200?')).toEqual({ operation: 'expression', expression: '15% de 200' });
    expect(parseCalcRequest('250 com 10% de desconto')).toEqual({ operation: 'discount', value: '250', percent: '10' });
  });
  it('não confunde frases comuns com cálculo', () => {
    expect(parseCalcRequest('academia amanhã às 9')).toBeNull();
    expect(parseCalcRequest('quanto custa um iphone?')).toBeNull();
  });
});
