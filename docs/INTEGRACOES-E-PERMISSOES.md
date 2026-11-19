# Integrações, permissões e privacidade

## Segurança implementada

| Proteção | Como |
|---|---|
| Isolamento entre usuários | RLS em todas as tabelas com `(select auth.uid()) = user_id`; GRANTs explícitos só para `authenticated` |
| Vínculos entre itens | Chaves estrangeiras compostas `(id, user_id)` impedem ligar sua tarefa ao projeto de outra pessoa |
| Tabelas só-leitura | `task_history`, `note_versions`, `reminder_deliveries`, `ai_usage` — escritas apenas por gatilhos/servidor |
| Funções do servidor | `claim_due_reminders`, `increment_ai_usage`, `purge_old_history` só executam com `service_role` |
| Chaves de IA | Somente em secrets das Edge Functions; o app nunca as recebe |
| Identidade | O servidor valida o token JWT; metadados editáveis pelo usuário nunca decidem permissão |
| Limite de uso da IA | `AI_DAILY_LIMIT` por usuário/dia (padrão 300 chamadas) |
| Prompt injection | Conteúdo das notas volta à IA marcado como `<dados_do_usuario>` e o prompt proíbe tratá-lo como instrução |
| Ações sensíveis | Excluir, guardar memória, criar várias coisas de uma vez e adicionar etapas exigem confirmação |
| Auditoria | `ai_action_logs` registra cada ação executada (visível em Configurações) |
| Idempotência | Mesma requisição não executa duas vezes; lembretes não duplicam (índice único + bloqueio na fila) |
| Anexos | Bucket privado, pasta por usuário, tipos e tamanho (20 MB) validados no banco e no storage |
| LGPD | Exportação completa em JSON, exclusão de conta em cascata, retenção configurável do histórico |

## Microfone e voz

- O microfone só abre quando você toca no botão ou ativa a palavra “Jarvis” (com aviso e consentimento registrado).
- A palavra de ativação funciona **somente com o app aberto e visível**; pausa automaticamente em segundo plano.
- No Chrome/Edge, o reconhecimento é feito pelo serviço de voz do navegador. Em outros navegadores, o áudio vai
  para a função `transcribe` (OpenAI), é processado em memória e **não é armazenado**.
- Não existe gravação oculta nem em segundo plano.

## Atalhos da Siri e do Android

- Cada aparelho usa uma **chave pessoal** (`jfv_...`) criada em Configurações. Ela é gerada no próprio aparelho;
  o banco guarda apenas o **hash SHA-256**, e a chave é exibida uma única vez.
- Pode ser **revogada** a qualquer momento e para de funcionar na hora. Há no máximo 10 chaves ativas por usuário
  e um limite diário de comandos (`SHORTCUT_DAILY_LIMIT`, padrão 500).
- O servidor executa o mesmo agente do app, e todas as consultas filtram pelo dono da chave (além do RLS).
- Ações sensíveis (excluir, guardar memória, criar vários itens) continuam exigindo um “sim” no comando seguinte.
- Links de atalho e “Compartilhar com o JARVIS” apenas **preenchem** a captura rápida; nada é executado sem o seu toque.

## Integrações externas

| Integração | Situação | O que falta |
|---|---|---|
| Claude (Anthropic) | Pronta | `ANTHROPIC_API_KEY` |
| OpenAI (alternativa / transcrição) | Pronta | `OPENAI_API_KEY` |
| Web Push | Pronta | Chaves VAPID + cron |
| Siri (app Atalhos) / Android (HTTP Shortcuts) | Pronta | Modo Nuvem + função `jarvis-command` publicada |
| FCM (Android/iOS) | Pronta | Projeto Firebase + `FCM_SERVICE_ACCOUNT` + app nativo |
| Google Calendar | Estrutura (`connected_accounts`, `external_id` único) | Credenciais OAuth do Google e fluxo de autorização |
| Gmail | Planejada | Exigirá pré-visualização e aprovação antes de qualquer envio |

O JARVIS nunca realiza compras, pagamentos ou envio de mensagens sem um fluxo explícito de confirmação.
