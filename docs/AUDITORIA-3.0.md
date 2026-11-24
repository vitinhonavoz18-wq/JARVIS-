# Auditoria inicial — J.A.R.V.I.S. FV 3.0

Data: 24/11/2026 · Branch de trabalho: `claude/amazing-gauss-pbkvv8` · Branch principal: `claude/friendly-fermi-28saj3`

## 1. Estado do repositório

| Item | Situação |
|---|---|
| Stack | React 19 + TypeScript + Vite + Tailwind 4, Three.js, Capacitor 8, Supabase (Postgres 17 + Edge Functions Deno), Cloudflare Worker |
| Testes (linha de base) | Vitest 121/121 · Deno 13/13 · lint e typecheck sem erros · build ok |
| Testes após a Fase 1 | Vitest **154/154** (31 frases de intenção novas) |
| Deploy do site | Cloudflare Worker `jarvis-fv` em https://jarvis.conectfly.com.br — **Modo Nuvem ativo** |
| Publicação automática | Workflow `Publicar JARVIS` bloqueado: `SUPABASE_ACCESS_TOKEN` no GitHub não está no formato `sbp_…` |

## 2. Backend (Supabase `srpkpptzbtyleoqwljrl`)

| Item | Situação |
|---|---|
| Migrations | 4 aplicadas (núcleo, storage/realtime, tokens de API, intelligence core) — nenhuma pendente |
| Tabelas públicas | 36, **todas com RLS** |
| Extensões | pgcrypto, pg_trgm, vault, uuid-ossp · `vector` **disponível, não instalada** · `pg_cron`/`pg_net` **ausentes** |
| Edge Functions | ai-chat, tts, transcribe, jarvis-command, automation-gateway, process-reminders, jarvis-events — todas ACTIVE |
| Avisos de segurança | (1) `integration_secrets` sem política — **intencional** (só o servidor lê); (2) `delete_my_account` SECURITY DEFINER — **intencional** (exclusão LGPD do próprio usuário); (3) proteção contra senhas vazadas **desativada** (ativar no painel Auth) |

## 3. Provedores (validados com chamadas reais, sem expor chaves)

| Provedor | Resultado |
|---|---|
| OpenAI (`gpt-5-mini` / `gpt-5`) | ✅ respondeu em produção |
| Anthropic | ❌ chave cadastrada tem formato `sk-ant-usr-…` (não é chave de API); fallback para OpenAI configurado |
| ElevenLabs (voz George, `eleven_flash_v2_5`) | ✅ áudio gerado em produção |
| Transcrição (OpenAI) | código pronto; não testado em produção |

## 4. Funcionalidades

**Completas:** tarefas, agenda, notas (Meu Cérebro), projetos, rotinas, foco, lembretes (app aberto), briefing/revisão, central executiva, AI Engine, 30+ ferramentas tipadas com classificação de risco e confirmação, auditoria (`ai_action_logs`), uso/custo (`ai_calls`, `ai_usage`), memória com consentimento (`user_memories`), voz premium com interrupção e fallback, detecção de silêncio.

**Parciais:**
- Memória: injeta até 25 memórias inteiras; sem busca semântica, resumo de conversas ou decisões.
- Lembretes com app fechado: função pronta, **agendador (pg_cron) não configurado** em produção.
- Contexto de conversa: últimas 10 mensagens, sem resumo.
- Streaming: só no áudio; o texto chega de uma vez.

**Indisponíveis:** Google Calendar/Gmail (sem OAuth), cálculos determinísticos, finanças completas, diário, documentos com busca, Bluetooth/Device Center, Desktop Companion, proatividade agendada no servidor.

## 5. Bugs encontrados

| # | Bug | Status |
|---|---|---|
| 1 | Perguntas com data viravam tarefa (“como está o clima amanhã??” → tarefa) | ✅ corrigido + 31 testes |
| 2 | “por que acordei cansado hoje” virava tarefa | ✅ corrigido |
| 3 | Chave Anthropic inválida derrubava a IA | ✅ corrigido (fallback em 401/403) |

## 6. Riscos e gargalos

- **Segurança:** o catálogo de ferramentas e o prompt principal são montados no cliente; o servidor só repassa ao modelo. As ferramentas rodam com RLS do usuário (não há chave de serviço no app), mas o prompt deve migrar para o servidor (Fase 2).
- **Custo:** `max_output_tokens` 8000/16000 sem cache de prompt; sem orçamento de contexto.
- **Performance:** bundle Three.js de 530 kB (já separado em chunk próprio).
- **Operação:** deploy manual até o token do GitHub ser corrigido.
