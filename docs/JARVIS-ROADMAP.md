# Roadmap J.A.R.V.I.S. FV 3.0 — progresso

Atualize este arquivo ao fim de cada sessão. A próxima sessão continua do primeiro item ⏳.

Legenda: ✅ feito e testado · 🟡 parcial · ⏳ próximo · ⬜ não iniciado · 🔒 bloqueado (credencial/hardware)

## Fase 1 — Fundação e estabilidade
- ✅ Auditoria (`docs/AUDITORIA-3.0.md`)
- ✅ Bug: perguntas viravam tarefa (31 frases em `src/core/agent/__tests__/intents.test.ts`)
- ✅ Supabase validado (RLS em 36 tabelas, funções ativas)
- ✅ OpenAI e ElevenLabs validados em produção; fallback de provedor em chave inválida
- ✅ Voz: VAD, descarte de áudio curto, cache de frases fixas, respostas curtas por voz
- 🔒 Anthropic: precisa de chave de API real (`sk-ant-api…`)
- 🔒 Publicação automática: `SUPABASE_ACCESS_TOKEN` (`sbp_…`) no GitHub
- ⬜ Ativar proteção contra senhas vazadas (painel Supabase → Auth)
- ⬜ Configurar pg_cron para `process-reminders` (lembretes com app fechado)

## Fase 2 — Inteligência e memória
- ✅ Calculation Engine: decimal exato (BigInt), parser seguro sem eval, lucro/margem/markup/comissão, desconto/acréscimo, variação, regra de três, juros simples/compostos com aportes, Price, estatísticas; ferramenta `calculate` + reconhecimento local (custo zero) — `src/core/calc/`
- 🟡 Calculation Engine: faltam conversão de unidades, cálculo de datas e botão “registrar no financeiro” após o cálculo
- ✅ Ferramenta `get_weather` (Open-Meteo, sem chave, cache 10 min) + perguntas de clima resolvidas localmente; cidade padrão Salvador
- ⬜ Campo “cidade” nas preferências do usuário (requer coluna nova)
- ⏳ Roteador de intenção com classificador barato
- ⬜ Prompt de sistema versionado no servidor + políticas aplicadas por código
- ✅ Memory Engine — banco: migration `20261124000005` aplicada em produção em 25/11 (pgvector 0.8.2, RLS nas 3 tabelas novas, buscas SECURITY INVOKER, registrada no histórico de migrations)
- ✅ Memory Engine — app: top-k por mensagem (+ essenciais), origem, deduplicação, correção (`update_memory`), esquecimento (`forget_memory`), busca em conversas, decisões (`record_decision`/`retrieve_decision`), bloqueio de segredos, conversa privada, Meu Cérebro
- ⏳ Memory Engine — falta: embeddings (função no servidor), resumo incremental de conversas, entidades (pessoas/empresas), linha do tempo, mapa de conhecimento
- ⬜ `max_tokens` 1.200/3.000 com reenvio quando a resposta for cortada; cache de prompt
- ⬜ Streaming de texto

## Fase 3 — Gestão da vida
⬜ Financeiro completo · Diário · Documentos com busca · Pessoas · Metas

## Fase 4 — Inteligência empresarial
⬜ Espaços por empresa · Conectores reais · GitHub · Google Calendar (OAuth) · Relatórios

## Fase 5 — Voz e dispositivos
⬜ Conversa contínua · Seleção de microfone/saída · Device Center (Web Bluetooth) · Capacitor nativo · Desktop Companion (Tauri)

## Fase 6 — Proatividade
⬜ Morning/Evening/Weekly no servidor com fila, idempotência e horário silencioso

## Fase 7 — Redesign e validação final
⬜ Interface premium · Responsividade · Acessibilidade · E2E · Performance · Deploy/rollback

## Histórico de publicações (Cloudflare Worker `jarvis-fv`)
| Data | Versão | Conteúdo | Voltar para a anterior |
|---|---|---|---|
| 25/11/2026 | `a73d2b2f-574d-4984-9a09-30462ae13ea6` | Memory Engine no app (busca relevante, decisões, modo privado, Meu Cérebro) | `npx wrangler@4.156.0 rollback 731b17fa-a3b8-411f-a865-64a5b761fce7 --name jarvis-fv` |
| 24/11/2026 | `731b17fa-a3b8-411f-a865-64a5b761fce7` | Voz (VAD/cache), correção do clima, Calculation Engine, `get_weather` | `npx wrangler@4.156.0 rollback 176ae4a7-0e27-46ab-bb01-722b2eb1b1b7 --name jarvis-fv` |
