/**
 * Avaliação do caminho local (sem IA): o que o interpretador resolve sozinho e o que ele
 * deve deixar para a IA. Regra central: pergunta NUNCA vira criação de tarefa/evento.
 * "ai" = o interpretador devolve "unknown" e a mensagem segue para o modelo.
 */
import { describe, it, expect } from 'vitest';
import { isQuestion, parseCommand } from '../nlu.ts';

const ctx = { now: new Date('2026-11-24T13:00:00Z'), tz: 'America/Bahia' };

type Expect = 'ai' | 'clarify' | string; // string = ferramenta esperada no caminho local
const CASES: [string, Expect][] = [
  // Perguntas sobre clima/assuntos gerais → IA (nunca tarefa)
  ['como esta o clima amanhã??', 'ai'],
  ['como está o clima amanha', 'ai'],
  ['como esta o clima amanha', 'ai'],
  ['vai chover amanhã?', 'ai'],
  ['qual a previsão do tempo pra amanhã', 'ai'],
  ['qual a previsao do tempo amanha?', 'ai'],
  ['por que acordei cansado hoje', 'ai'],
  ['quem é você?', 'ai'],
  ['quem e voce', 'ai'],
  ['resume minha semana e sugere prioridades', 'ai'],
  ['quanto é 15% de 200?', 'ai'],
  ['comprei uma bateria por 200 e vendi por 350, quanto lucrei?', 'ai'],
  ['reunião sexta às 14h?', 'list_events'],
  ['academia amanhã às 9??', 'ai'],
  ['será que dá tempo de ir na academia amanhã às 7?', 'ai'],
  // Consultas → ferramentas de leitura locais
  ['o que tenho pra fazer hoje?', 'get_agenda'],
  ['o que tenho hoje', 'get_agenda'],
  ['oq tenho hoje?', 'get_agenda'],
  ['quais minhas tarefas de amanhã?', 'list_tasks'],
  ['quando é minha reunião amanhã?', 'list_events'],
  ['onde fica a reunião de amanhã?', 'list_events'],
  ['tenho dentista amanha as 10?', 'get_agenda'],
  // Comandos explícitos → criação local
  ['me lembre amanhã de comprar o vinho às 19:00', 'create_task'],
  ['me lembre amanha de comprar o vinho as 19:00', 'create_task'],
  ['crie uma tarefa estudar IA amanhã às 10', 'create_task'],
  ['cria tarefa: pagar boleto sexta', 'create_task'],
  ['academia amanhã às 9', 'create_task'],
  ['reunião sexta às 14h', 'create_event'],
  ['marque reunião com Ana sexta às 15h', 'create_event'],
  ['anote comprar pão amanhã', 'create_task'],
  // Hora já passou hoje → pergunta o dia em vez de supor
  ['me lembre de criar o app às 8:00 fazer pelo claude code', 'clarify'],
];

function route(text: string): string {
  const r = parseCommand(text, ctx) as { kind: string; calls?: { tool: string }[] };
  if (r.kind === 'unknown') return 'ai';
  if (r.kind === 'clarify') return 'clarify';
  return r.calls?.[0]?.tool ?? r.kind;
}

describe('roteamento de intenções (caminho local)', () => {
  it.each(CASES)('%s → %s', (text, expected) => {
    expect(route(text)).toBe(expected);
  });

  it('nenhuma pergunta cria tarefa, evento ou lembrete', () => {
    for (const [text] of CASES.filter(([t]) => isQuestion(t))) {
      expect(['create_task', 'create_event', 'create_reminder']).not.toContain(route(text));
    }
  });

  it('tem pelo menos 30 frases', () => expect(CASES.length).toBeGreaterThanOrEqual(30));
});
