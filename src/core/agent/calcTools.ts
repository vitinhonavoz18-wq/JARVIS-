/**
 * Ferramenta `calculate` do agente (JARVIS Calculation Engine): cálculos exatos sem depender da IA.
 */
import { CalcError, CalcInput, runCalc } from '../calc/index.ts';
import { registerTools, tool, type ToolDef } from './tools.ts';

const calculate = tool({
  name: 'calculate',
  description:
    'Calcula de forma EXATA (decimal, sem arredondamento de ponto flutuante): expressões matemáticas, porcentagens, lucro/margem/markup com comissão, desconto, acréscimo, variação percentual, regra de três, juros simples e compostos (com aportes), parcelamento Price e estatísticas. Use SEMPRE esta ferramenta em vez de calcular de cabeça.',
  readOnly: true,
  schema: CalcInput,
  output: 'Resultado com os passos do cálculo e os valores numéricos.',
  async run(_ctx, i) {
    try {
      const r = runCalc(i);
      const data = Object.fromEntries(Object.entries(r.values).map(([k, v]) => [k, v.toString()]));
      return { ok: true, message: `${r.title}:\n${r.steps.map((s) => `• ${s}`).join('\n')}`, data };
    } catch (e) {
      return { ok: false, message: e instanceof CalcError ? `Não consegui calcular: ${e.message}` : 'Não consegui calcular essa expressão.' };
    }
  },
});

registerTools([calculate] as unknown as ToolDef[]);
