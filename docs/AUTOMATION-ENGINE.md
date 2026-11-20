# Automation Engine — integração JARVIS ⇄ n8n

## Como funciona

```
Você (voz/texto) → JARVIS identifica a automação REGISTRADA → valida parâmetros e permissões
→ pede confirmação se o risco exigir → registra a execução (fila persistente)
→ chama o Webhook do n8n (assinado com HMAC + cabeçalho de autenticação)
→ status “iniciada” (aceito ≠ concluído) → n8n envia o resultado para /jarvis-events
→ status “concluída” ou “falhou” → painel, alerta e push (se configurado)
```

Estados reais: **na fila → solicitada → iniciada → em andamento → concluída | falhou | cancelada | sem resposta no prazo**.

- A **API pública do n8n** (`/api/v1`, cabeçalho `X-N8N-API-KEY`) é usada para: testar a conexão,
  descobrir workflows e execuções, criar rascunhos (inativos) e ativar com aprovação explícita.
- A API pública **não executa** workflows: a execução é sempre pelo **Webhook** do workflow, registrado
  explicitamente no Automation Studio.
- Interromper execuções depende da versão do n8n (`POST /executions/{id}/stop`); se a instância não
  oferecer, o JARVIS informa em vez de fingir.

## Passo a passo

1. **n8n → Settings → n8n API → Create an API key.** Prefira escopos de leitura de workflows/execuções
   (e `workflow:create`/`workflow:activate` se quiser criar rascunhos pelo JARVIS).
2. **JARVIS → Automation Studio → Conectar n8n**: URL base (HTTPS) + chave. Ao salvar, o JARVIS testa a
   conexão de verdade e mostra **uma única vez** o *segredo de eventos*, o *ID da conexão* e a *URL de eventos*.
3. **No servidor do n8n**, defina as variáveis de ambiente:
   ```
   JARVIS_EVENTS_SECRET=<segredo de eventos>
   NODE_FUNCTION_ALLOW_BUILTIN=crypto
   ```
4. **Sincronizar** para descobrir os workflows. Para cada workflow com gatilho Webhook que o JARVIS pode
   executar, clique **Registrar**: defina nome, apelidos para voz, risco, modo (síncrono/assíncrono),
   prazo, parâmetros permitidos (JSON Schema) e, se usar *Header Auth* no Webhook, o cabeçalho e o valor.
5. Importe os modelos de `n8n-templates/` para começar.

## O que o JARVIS envia ao Webhook

Cabeçalhos: `X-Jarvis-Correlation-Id`, `X-Jarvis-Timestamp`, `X-Jarvis-Signature: sha256=<hmac>` e o
cabeçalho de autenticação configurado. Corpo:
```json
{
  "correlation_id": "uuid",
  "automation": "Relatório de vendas",
  "input": { "periodo": "semana" },
  "requested_at": "2026-11-20T11:00:00Z",
  "callback": { "url": "https://<projeto>.supabase.co/functions/v1/jarvis-events", "connection_id": "uuid", "schema_version": "1.0" }
}
```
Para validar a origem no n8n: `HMAC-SHA256(JARVIS_EVENTS_SECRET, timestamp + "." + corpo_bruto)`.

## Eventos do n8n para o JARVIS (`POST /functions/v1/jarvis-events`)

Cabeçalhos obrigatórios: `X-Jarvis-Connection`, `X-Jarvis-Timestamp` (Unix, segundos) e
`X-Jarvis-Signature: sha256=<HMAC-SHA256(segredo, timestamp + "." + corpo)>`. Janela de 5 minutos
(anti-replay); `event_id` repetido é ignorado (idempotência).

```json
{
  "event_id": "uuid",
  "event_type": "workflow.execution.completed",
  "schema_version": "1.0",
  "source": "n8n",
  "project_id": "flydelivery",
  "workflow_id": "123",
  "execution_id": "881",
  "occurred_at": "2026-11-20T11:02:10Z",
  "correlation_id": "uuid-recebido-no-webhook",
  "payload": { "summary": "Relatório enviado", "output": { "vendas": 12 } }
}
```

| `event_type` | `payload` | Efeito no JARVIS |
|---|---|---|
| `workflow.execution.started` | — | execução “em andamento” |
| `workflow.execution.completed` | `summary`, `output` | execução “concluída” |
| `workflow.execution.failed` | `error`, `summary` | “falhou” + alerta |
| `project.alert` | `severity`, `title`, `message`, `link` | alerta (crítico também vai por push) |
| `project.metrics.snapshot` | `capability`, `data`, `period` | indicadores na Central Executiva (com fonte e horário) |
| `project.activity` | livre | registrado no histórico de eventos |

Este formato é o contrato interno do JARVIS (não é um esquema nativo do n8n).

## Criar automação com JARVIS
Diga “Jarvis, quero que toda segunda às 8h seja preparado um relatório das vendas da semana anterior”.
O JARVIS monta gatilho (cron) e etapas, mostra a proposta e, com sua aprovação, cria o workflow
**inativo** no n8n. Você configura a fonte de dados, testa com dados controlados e só então ativa.
Fluxos que enviam mensagens externas ou alteram dados importantes nunca são ativados automaticamente.
