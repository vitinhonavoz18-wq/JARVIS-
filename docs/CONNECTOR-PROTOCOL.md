# Jarvis Connector Protocol (v1)

Contrato para qualquer projeto (FlyDelivery, TG Baterias, Connectfly, Farmácia Preço Bom, SiteCreatorFly…)
expor dados e ações ao JARVIS **sem** compartilhar banco de dados ou credenciais administrativas.

## Autenticação
`Authorization: Bearer <token do projeto>` — token exclusivo para o JARVIS, com permissões mínimas.
O JARVIS guarda o token criptografado (AES-256-GCM) no servidor. Sempre HTTPS.

## Endpoints

### `GET /jarvis/health`
```json
{ "status": "healthy", "detail": "Operacional" }
```
`status`: `healthy` | `degraded`.

### `GET /jarvis/capabilities`
```json
{
  "capabilities": [
    { "id": "metrics.summary", "name": "Indicadores", "description": "Empresas ativas, cadastros e pedidos", "risk": "read", "scope": "metrics:read", "aggregatedOnly": true },
    { "id": "stock.low", "name": "Estoque baixo", "description": "Produtos abaixo do mínimo", "risk": "read", "scope": "stock:read" },
    { "id": "tasks.create", "name": "Criar tarefa interna", "description": "", "risk": "reversible", "scope": "tasks:write" }
  ]
}
```
`risk`: `read` | `reversible` | `sensitive` | `external` | `destructive`.
O JARVIS exige confirmação explícita do usuário para `sensitive`, `external` e `destructive`,
e nunca chama uma capacidade cujo `scope` não foi autorizado no cadastro do projeto.

### `POST /jarvis/actions/{capability}`
Requisição:
```json
{ "input": { "period": "week" }, "correlation_id": "uuid" }
```
Resposta:
```json
{ "ok": true, "data": { "empresas_ativas": 42, "novos_cadastros": 5, "pedidos_semana": 1830 } }
```
Erro: `{ "ok": false, "error": "mensagem" }`.

## Regras de privacidade
- Prefira dados **agregados** (totais, médias). Não devolva dados de saúde, documentos ou contatos
  de clientes em capacidades de indicadores.
- `customers.search` só é usado se o projeto estiver marcado como “dados detalhados” no JARVIS.
- Toda informação exibida no JARVIS mostra a **fonte** e o **horário** da consulta.

## Capacidades recomendadas por projeto
| Projeto | Capacidades |
|---|---|
| Connectfly | `metrics.summary`, `alerts.list`, `tasks.pending`, `tasks.create` |
| FlyDelivery | `metrics.summary`, `metrics.compare` (`{period: "week"\|"month"}`), `integrations.status`, `alerts.list` |
| Farmácia Preço Bom | `metrics.summary`, `tasks.pending`, `tasks.create`, `alerts.list` |
| TG Baterias | `metrics.summary`, `stock.low`, `alerts.list` |
| SiteCreatorFly | `metrics.summary`, `alerts.list` |

## Alternativa sem código no projeto: via n8n
Cadastre no Automation Studio uma automação **síncrona** com a “capacidade fornecida” (ex.: `stock.low`)
e o projeto vinculado. O workflow consulta a fonte e responde no formato:
```json
{ "jarvis": { "status": "succeeded", "summary": "3 produtos abaixo do mínimo", "output": { "itens": [] } } }
```
