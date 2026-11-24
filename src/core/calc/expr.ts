/**
 * Parser seguro de expressões matemáticas (descida recursiva). NUNCA usa eval/Function.
 * Aceita números em formato brasileiro (1.234,56), %, ^, parênteses e funções simples.
 */
import { CalcError, Dec } from './decimal.ts';

const MAX_LEN = 300;
const MAX_TOKENS = 200;
const FUNCS = new Set(['sqrt', 'raiz', 'abs', 'min', 'max', 'round', 'arredondar']);

type Tok = { t: 'num'; v: Dec } | { t: 'op'; v: string } | { t: 'fn'; v: string } | { t: '(' } | { t: ')' } | { t: ',' };

/** Converte linguagem natural comum em notação: "15% de 200", "2 vezes 3", "10 dividido por 4". */
export function normalizeExpression(input: string): string {
  let s = input.toLowerCase().replace(/r\$\s*/g, '').replace(/(?<=[\d)\s])[×x](?=\s*[\d(])/g, '*').replace(/÷/g, '/');
  s = s
    .replace(/\bdividido\s+por\b/g, '/')
    .replace(/\b(vezes|multiplicado\s+por)\b/g, '*')
    .replace(/\bmais\b/g, '+')
    .replace(/\bmenos\b/g, '-')
    .replace(/\belevado\s+a\b/g, '^')
    .replace(/\braiz\s+(quadrada\s+)?de\s+([\d.,]+)/g, 'sqrt($2)');
  // "15% de 200" → (15%*200)
  s = s.replace(/([\d.,]+)\s*%\s*(?:de|do|da|sobre)\s+([\d.,]+)/g, '($1%*$2)');
  return s.replace(/[?!=]+\s*$/, '').trim();
}

/** Número em pt-BR ou en: "1.234,56" | "1234.56" | "1.000" (milhar) | "0,5". */
export function parseNumberBR(raw: string): Dec {
  let s = raw.trim();
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  return Dec.of(s);
}

function tokenize(src: string): Tok[] {
  if (src.length > MAX_LEN) throw new CalcError('Expressão muito longa.');
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    const num = /^\d[\d.,]*|^[.,]\d+/.exec(src.slice(i));
    if (num) {
      // vírgula seguida de espaço é separador de argumentos, não decimal
      let text = num[0];
      const sepArg = /,(?=\s|$)/.exec(text);
      if (sepArg) text = text.slice(0, sepArg.index);
      text = text.replace(/[.,]$/, '');
      out.push({ t: 'num', v: parseNumberBR(text) });
      i += text.length;
      continue;
    }
    const word = /^[a-z]+/.exec(src.slice(i));
    if (word) {
      if (!FUNCS.has(word[0])) throw new CalcError(`Termo não reconhecido: “${word[0]}”.`);
      out.push({ t: 'fn', v: word[0] });
      i += word[0].length;
      continue;
    }
    if ('+-*/^%'.includes(c)) out.push({ t: 'op', v: c });
    else if (c === '(') out.push({ t: '(' });
    else if (c === ')') out.push({ t: ')' });
    else if (c === ',' || c === ';') out.push({ t: ',' });
    else throw new CalcError(`Caractere inválido: “${c}”.`);
    i++;
    if (out.length > MAX_TOKENS) throw new CalcError('Expressão muito longa.');
  }
  return out;
}

export function evaluate(expression: string): Dec {
  const toks = tokenize(normalizeExpression(expression));
  if (!toks.length) throw new CalcError('Expressão vazia.');
  let p = 0;
  let depth = 0;
  const peek = () => toks[p];
  const isOp = (v: string) => peek()?.t === 'op' && (peek() as { v: string }).v === v;

  function expr(): Dec {
    let v = term();
    while (isOp('+') || isOp('-')) {
      const op = (toks[p++] as { v: string }).v;
      v = op === '+' ? v.add(term()) : v.sub(term());
    }
    return v;
  }
  function term(): Dec {
    let v = power();
    while (isOp('*') || isOp('/')) {
      const op = (toks[p++] as { v: string }).v;
      v = op === '*' ? v.mul(power()) : v.div(power());
    }
    return v;
  }
  function power(): Dec {
    const base = unary();
    if (isOp('^')) {
      p++;
      const e = power();
      if (!e.isInteger()) throw new CalcError('Expoente deve ser inteiro.');
      return base.pow(e.toNumber());
    }
    return base;
  }
  function unary(): Dec {
    if (isOp('-')) { p++; return unary().neg(); }
    if (isOp('+')) { p++; return unary(); }
    let v = primary();
    while (isOp('%')) { p++; v = v.pct(); }
    return v;
  }
  function primary(): Dec {
    const tk = toks[p++];
    if (!tk) throw new CalcError('Expressão incompleta.');
    if (tk.t === 'num') return tk.v;
    if (tk.t === '(') {
      if (++depth > 30) throw new CalcError('Parênteses demais.');
      const v = expr();
      if (toks[p++]?.t !== ')') throw new CalcError('Parêntese não fechado.');
      depth--;
      return v;
    }
    if (tk.t === 'fn') {
      if (toks[p++]?.t !== '(') throw new CalcError(`Use ${tk.v}(…).`);
      const args = [expr()];
      while (peek()?.t === ',') { p++; args.push(expr()); }
      if (toks[p++]?.t !== ')') throw new CalcError('Parêntese não fechado.');
      return applyFn(tk.v, args);
    }
    throw new CalcError('Expressão inválida.');
  }

  const result = expr();
  if (p !== toks.length) throw new CalcError('Expressão inválida.');
  return result;
}

function applyFn(name: string, a: Dec[]): Dec {
  switch (name) {
    case 'sqrt': case 'raiz': return a[0].sqrt();
    case 'abs': return a[0].abs();
    case 'min': return a.reduce((m, x) => (x.cmp(m) < 0 ? x : m));
    case 'max': return a.reduce((m, x) => (x.cmp(m) > 0 ? x : m));
    case 'round': case 'arredondar': return a[0].round(a[1] ? a[1].toNumber() : 0);
  }
  throw new CalcError(`Função desconhecida: ${name}`);
}
