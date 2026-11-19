# J.A.R.V.I.S. FV — Personal Intelligence OS

Assistente pessoal com inteligência artificial, voz e automações para **Franklin Vitor**.
Conversa em português, entende comandos naturais (“academia amanhã às 9, me avise meia hora antes”),
**executa ações reais** (tarefas, agenda, notas, lembretes, projetos, hábitos, foco) e só confirma
depois que o dado foi salvo.

> “JARVIS não é apenas uma inteligência artificial que responde. É uma inteligência artificial que ajuda a administrar a minha vida.”

## O que já funciona

| Módulo | Situação |
|---|---|
| Central de Comando (dashboard com dados reais, núcleo 3D com estados) | ✅ |
| Conversa por texto com execução de ações | ✅ (interpretador local em pt‑BR, sem custo) |
| IA avançada (Claude / OpenAI) com ferramentas tipadas | ✅ código pronto — precisa da chave no servidor |
| Voz: falar, ouvir resposta, interromper, palavra “Jarvis” | ✅ Chrome/Edge (nativo); outros navegadores via servidor |
| Tarefas: hoje, amanhã, semana, pendentes, atrasadas, concluídas, Kanban, prioridades, subtarefas, recorrência, histórico | ✅ |
| Agenda: dia, semana, mês, linha do tempo, conflitos, recorrência com exceções | ✅ |
| Meu Cérebro: editor rico, pastas, etiquetas, fixar, favoritos, lixeira, versões, ditado, anexos | ✅ (versões e anexos no modo nuvem) |
| Lembretes persistentes + push com app fechado | ✅ código + fila no banco; push exige configuração (VAPID/FCM) |
| Projetos (lista, quadro, cronograma, etapas com aprovação) | ✅ |
| Rotinas e hábitos (contagem separada das tarefas) | ✅ |
| Mission Mode (foco com cronômetro, pausa, subtarefas, registro) | ✅ |
| Morning Briefing / Evening Review / relatório semanal | ✅ fatos e sugestões separados |
| Caixa de entrada universal (vários itens de uma vez, com prévia) | ✅ |
| Pesquisa global (Ctrl K) | ✅ |
| Memória pessoal com consentimento (ver, editar, excluir, exportar) | ✅ |
| Configurações, exportação de dados e exclusão de conta (LGPD) | ✅ |
| Atalhos da Siri (“E aí Siri, Jarvis”) e Android, sem abrir o app | ✅ código pronto — precisa do Modo Nuvem |
| Compartilhar texto de outros apps para o JARVIS | ✅ |
| Google Calendar / Gmail | ⏳ estrutura preparada, sem credenciais — aparece como “não configurado” |

## Dois modos de funcionamento

- **Modo Local** (sem configurar nada): tudo funciona no navegador, dados ficam **só neste aparelho**.
  Lembretes aparecem com o app aberto. Ideal para experimentar.
- **Modo Nuvem** (com Supabase): login, sincronização entre aparelhos, push com app fechado, IA avançada,
  anexos e histórico de versões. Passo a passo em [`docs/INSTALACAO.md`](docs/INSTALACAO.md).

## Começar em 1 minuto (Modo Local)

```bash
npm install
```

```bash
npm run dev
```

Abra o endereço mostrado (normalmente `http://localhost:5173`).

## Arquitetura (resumo)

```
src/core/            ← cérebro do sistema (TypeScript puro, testado)
  time.ts            ← datas e fuso horário (America/Bahia por padrão)
  agent/nlu.ts       ← interpretador de comandos em português (sem custo de IA)
  agent/tools.ts     ← 30 ferramentas tipadas (Zod) — as MESMAS usadas pela tela e pela IA
  agent/agent.ts     ← orquestrador: local → IA; confirmação; idempotência; auditoria
  data/              ← repositório (Modo Local ou Supabase com RLS)
src/pages/           ← telas (React + Tailwind + Motion)
src/components/core/ ← núcleo holográfico 3D (Three.js, com versão leve sem WebGL)
supabase/migrations/ ← banco de dados versionado com RLS
supabase/functions/  ← servidor: ai-chat, process-reminders, transcribe, jarvis-command (Siri/Android)
```

Princípios: nada de dados fictícios; sucesso só depois de salvar; ações destrutivas, memórias e
múltiplas criações pedem confirmação; chaves de API nunca vão para o aplicativo.

## Comandos úteis

| Comando | O que faz |
|---|---|
| `npm run dev` | Abre o app em modo desenvolvimento |
| `npm run build` | Gera a versão de produção em `dist/` |
| `npm test` | 74 testes automáticos (cenários do JARVIS, datas, fuso, recorrência) |
| `npm run test:db` | Aplica as migrations num Postgres temporário e testa a segurança (RLS) |
| `npm run test:e2e` | Testa o app num navegador real (precisa de `npx vite preview` rodando) |
| `npm run lint` / `npm run typecheck` | Qualidade e tipos |

## Documentação

- [Instalação e configuração do Supabase](docs/INSTALACAO.md)
- [Integrações, permissões e privacidade](docs/INTEGRACOES-E-PERMISSOES.md)
- [Guia mobile (Android/iOS com Capacitor)](docs/MOBILE.md)
- [Relatório de validação](docs/RELATORIO-VALIDACAO.md)
- [Dependências externas pendentes](docs/DEPENDENCIAS-EXTERNAS.md)
