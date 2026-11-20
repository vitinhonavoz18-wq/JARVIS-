# Relatório de validação

## JARVIS 2.0 (20/11/2026)

| Verificação | Resultado |
|---|---|
| Testes unitários/integrados (`npm test`) | ✅ 105/105 |
| Segurança do banco 2.0 (Postgres 16 real): isolamento, segredos ilegíveis, status não forjáveis, fila sem duplicidade, timeout com alerta, eventos idempotentes | ✅ |
| Reversão da migration 2.0 e reaplicação | ✅ |
| `deno check` das 6 Edge Functions | ✅ |
| Integração do Automation Engine no Deno com **n8n simulado via HTTP real** (assinatura HMAC, header auth, aceito≠concluído, modo síncrono, retentativa, falha+alerta, evento duplicado, alerta crítico→push) | ✅ 6/6 |
| Assinatura gerada como no n8n (`crypto` do Node) aceita pelo JARVIS | ✅ |
| Navegador real (`npm run test:e2e`) incluindo telas 2.0 | ✅ 29/29 |

**Não verificado (falta acesso):** instância n8n real, chave OpenAI/Anthropic real, APIs reais de
Connectfly/FlyDelivery/Farmácia/TG Baterias/SiteCreatorFly (repositórios não disponíveis nesta sessão),
projeto Supabase novo (sem acesso pela conexão desta sessão). Tudo isso está pronto no código e mostra
estado “não conectado/indisponível” na interface — nada é simulado.

---

# v0.1.0 (19/11/2026)

## Verificações automáticas executadas

| Verificação | Resultado |
|---|---|
| TypeScript (app) | ✅ sem erros |
| TypeScript (Edge Functions, contra os tipos reais das bibliotecas) | ✅ sem erros |
| ESLint | ✅ sem problemas |
| Build de produção | ✅ (núcleo 3D e editor carregados sob demanda) |
| Testes unitários/integrados (`npm test`) | ✅ 74/74 |
| Testes de segurança do banco (`npm run test:db`, Postgres 16 real) | ✅ todos |
| Teste no navegador real (`npm run test:e2e`, Chromium desktop + celular) | ✅ 22/22 |
| `deno check` das 4 Edge Functions (Deno 2.5) | ✅ |
| Agente executado dentro do Deno (criar → consultar → excluir com “sim”) | ✅ |

## Produção

Publicado em **https://jarvis.conectfly.com.br** (Cloudflare Worker `jarvis-fv`, HTTPS, cabeçalhos de segurança).
O teste completo de navegador foi executado **contra o endereço público**: 22/22.

## Cenários obrigatórios do documento

| # | Cenário | Como foi testado | Resultado |
|---|---|---|---|
| 1 | “Jarvis, academia amanhã às 9.” | unitário + navegador | ✅ tarefa em 20/11 09:00, sem duplicar |
| 2 | “me lembre da reunião às 11h, uma hora antes” | unitário | ✅ usa o evento existente; lembrete às 10h |
| 3 | “anote que preciso estudar novas estratégias de vendas” | unitário + navegador | ✅ nota salva e encontrada na busca |
| 4 | “o que tenho para amanhã?” | unitário + navegador | ✅ só dados reais; vazio quando não há nada |
| 5 | “altere a academia de amanhã para 7h” | unitário + navegador | ✅ mesma tarefa, lembrete movido junto |
| 6 | Recarregar o app | unitário + navegador | ✅ dados permanecem |
| 7 | Notificação | parcial | ⚠ fila, bloqueio, silêncio e retentativas testados no banco; envio real de push **não testado** (sem chaves VAPID/FCM neste ambiente) |
| 8 | Falha da IA | unitário (provedor simulado indisponível) | ✅ mensagem clara, nada marcado como concluído |
| 9 | “marque uma reunião às 11h” | unitário + navegador | ✅ pergunta o dia, não cria nada até responder |
| 10 | Acessar dados de outro usuário | Postgres real com RLS | ✅ negado (ler, alterar, apagar, inserir em nome de outro, vincular a projeto alheio, funções do servidor, anônimo) |

Também testados: recorrência (seg/qua/sex, diária, mensal, exceções), fuso horário (incluindo horário de verão),
idempotência, captura múltipla com confirmação, memória com autorização, projetos em etapas, modo foco,
hábitos (“1 de 4 sessões”), briefing, “o que posso deixar para amanhã”, exclusão com confirmação,
proteção contra lembrete duplicado e exclusão de conta em cascata.

## Atalhos da Siri e do Android

| Verificação | Resultado |
|---|---|
| Chave inválida, revogada ou inexistente é recusada | ✅ teste do banco |
| Outro usuário não vê nem revoga suas chaves; usuário não altera contadores | ✅ teste do banco |
| Limite diário de comandos | ✅ teste do banco |
| Todas as consultas do servidor filtram pelo dono | ✅ teste unitário |
| Fluxo completo do agente no motor do servidor (Deno) | ✅ |
| Chamada real pela Siri / HTTP Shortcuts | ⚠ não testado (exige o projeto Supabase publicado e um celular) |

## O que NÃO foi possível verificar aqui

- **Projeto Supabase real**: o único projeto da conta é o CRM de um cliente; não foi alterado. As migrations
  foram validadas num Postgres 16 local que simula o Supabase. Rodar no Supabase real é o próximo passo.
- **IA real (Claude/OpenAI)**: sem chave neste ambiente; o fluxo foi validado com provedor simulado.
- **Push real** (Web Push/FCM) e **app nativo** Android/iOS: dependem de chaves e dispositivos.
- **Microfone real**: o navegador de testes não tem microfone; a interface e os estados foram verificados.
- **Sincronização offline com fila de conflitos no modo nuvem**: não implementada nesta versão (o Modo Local
  funciona 100% offline). Listada em melhorias.
