# Instalação e configuração (Modo Nuvem)

Este guia liga o JARVIS ao Supabase para ter login, sincronização, push com app fechado e IA avançada.
Tempo estimado: 30–40 minutos.

> **Importante:** use um **projeto Supabase novo e exclusivo** para o JARVIS. Não reutilize o projeto
> “CRM FARMÁCIA PREÇO BOM” — misturar dados pessoais com dados de um cliente é um risco de privacidade.

## 1. Criar o projeto Supabase

1. Acesse <https://supabase.com/dashboard> e clique em **New project**.
2. Nome: `jarvis-fv`. Região: **South America (São Paulo)**. Crie uma senha forte e guarde-a.
3. Aguarde o projeto ficar pronto (cerca de 2 minutos).

## 2. Criar as tabelas (migrations)

1. No menu lateral, abra **SQL Editor** → **New query**.
2. Copie todo o conteúdo de `supabase/migrations/20261119000001_jarvis_core.sql`, cole e clique em **Run**.
   Depois faça o mesmo com `20261119000003_api_tokens.sql` (chaves dos atalhos).
   Resultado esperado: “Success. No rows returned”.
3. Repita com `supabase/migrations/20261119000002_storage_and_realtime.sql`.
4. Confirme em **Table Editor**: devem aparecer tabelas como `tasks`, `notes`, `reminders`.

## 3. Conectar o aplicativo

1. Em **Project Settings → API Keys**, copie a **Project URL** e a **Publishable key** (`sb_publishable_...`).
2. Na pasta do projeto, copie `.env.example` para `.env` e preencha:
   ```
   VITE_SUPABASE_URL=https://xxxx.supabase.co
   VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_xxxx
   ```
3. Rode `npm run dev`. A tela de login deve aparecer. Crie sua conta.
4. Confirme: em **Authentication → Users** aparece seu e-mail, e em `user_preferences` há uma linha com seu nome.

> A publishable key é pública por natureza: a proteção dos dados é feita pelas regras RLS do banco.
> **Nunca** coloque a `service_role` / secret key no arquivo `.env` do frontend.

## 4. Publicar as funções de servidor

Instale o Supabase CLI (<https://supabase.com/docs/guides/cli>) e rode, na pasta do projeto:

```bash
supabase login
```

```bash
supabase link --project-ref SEU_PROJECT_REF
```

```bash
supabase functions deploy ai-chat
```

```bash
supabase functions deploy process-reminders
```

```bash
supabase functions deploy transcribe
```

```bash
supabase functions deploy jarvis-command
```

> A função `jarvis-command` (atalhos da Siri/Android) usa o código do app em `src/core`. O Supabase CLI
> inclui esses arquivos automaticamente; rode o comando a partir da pasta raiz do projeto.

## 5. Configurar a IA (opcional, recomendado)

Crie uma chave em <https://console.anthropic.com> e configure:

```bash
supabase secrets set ANTHROPIC_API_KEY=sua-chave AI_DAILY_LIMIT=300
```

Modelos usados por padrão: `claude-haiku-5-5` para pedidos simples e `claude-opus-5-5` para planejamento
(altere com `ANTHROPIC_MODEL_FAST` e `ANTHROPIC_MODEL`). Para usar OpenAI: `AI_PROVIDER=openai` e `OPENAI_API_KEY`.

Confirme: em **Configurações** do app, “IA avançada” deve mostrar **conectada**.

> Custo: os comandos comuns (tarefas, agenda, notas, lembretes) são resolvidos localmente, **sem custo de IA**.
> A IA só é chamada para pedidos que o interpretador local não entende.

## 6. Notificações com o app fechado

**a) Chaves Web Push (navegador):**

```bash
npx web-push generate-vapid-keys
```

- Coloque a chave **pública** no `.env`: `VITE_VAPID_PUBLIC_KEY=...`
- Configure as duas no servidor:

```bash
supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:seu-email
```

**b) Agendamento a cada minuto:**

1. Gere um segredo longo (ex.: um gerenciador de senhas) e configure: `supabase secrets set CRON_SECRET=...`
2. No **SQL Editor**, rode (trocando os valores):
   ```sql
   select vault.create_secret('https://SEU-PROJETO.supabase.co', 'project_url');
   select vault.create_secret('O-MESMO-CRON_SECRET', 'cron_secret');
   ```
3. Rode o conteúdo de `supabase/setup/cron.sql`.
4. Teste: em **Configurações → Notificações**, clique “Ativar notificações” e depois “Enviar lembrete de teste”.
   Feche a aba; em ~2 minutos a notificação deve chegar. Em **Integrations → Cron** você vê as execuções.

**c) Celular (Android/iOS):** veja [MOBILE.md](MOBILE.md) — requer um projeto Firebase (`FCM_SERVICE_ACCOUNT`).

## 7. Publicar o site (Cloudflare Pages)

1. No Cloudflare, **Workers & Pages → Create → Pages → Connect to Git** e escolha o repositório.
2. Build command: `npm run build` · Output: `dist`.
3. Em **Environment variables**, adicione as mesmas variáveis `VITE_...` do `.env`.
4. Crie o arquivo de redirecionamento SPA (já incluído em `public/_redirects`).
5. No Supabase, em **Authentication → URL Configuration**, adicione o endereço do site em *Site URL* e *Redirect URLs*.

## 8. Atalhos da Siri e do Android (opcional)

Depois dos passos 1–4, abra **Configurações → Atalhos (Siri e Android)** no app, gere uma chave para o
aparelho e siga o passo a passo mostrado na própria tela. Teste rápido pelo terminal:

```bash
curl -X POST "https://SEU-PROJETO.supabase.co/functions/v1/jarvis-command?format=text" -H "Authorization: Bearer SUA_CHAVE" -H "Content-Type: application/json" -d '{"text":"o que tenho para amanhã?"}'
```

Resultado esperado: o resumo real da sua agenda de amanhã, em texto.
