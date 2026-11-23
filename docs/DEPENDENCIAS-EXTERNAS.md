# Dependências externas ainda necessárias

| Item | Para quê | Onde obter | Custo |
|---|---|---|---|
| Projeto Supabase exclusivo | Login, sincronização, push, anexos | supabase.com | Plano gratuito atende uso pessoal |
| `ANTHROPIC_API_KEY` | IA avançada (pedidos livres, planejamento) | console.anthropic.com | Pago por uso; comandos comuns não usam IA |
| Chaves VAPID | Push no navegador com app fechado | `npx web-push generate-vapid-keys` | Grátis |
| `CRON_SECRET` + segredos no Vault | Disparo dos lembretes a cada minuto | Você gera | Grátis |
| Projeto Firebase + `FCM_SERVICE_ACCOUNT` | Push no app Android/iOS | console.firebase.google.com | Grátis |
| Conta Apple Developer | Publicar no iPhone | developer.apple.com | US$ 99/ano |
| Conta Google Play | Publicar no Android | play.google.com/console | US$ 25 (única vez) |
| `OPENAI_API_KEY` (opcional) | Voz em Safari/Firefox; IA alternativa | platform.openai.com | Pago por uso |
| Credenciais OAuth Google (opcional) | Google Calendar | console.cloud.google.com | Grátis |
| `INTEGRATIONS_ENCRYPTION_KEY` | Cifrar credenciais do n8n e dos projetos | `openssl rand -base64 32` | Grátis |
| Instância n8n + chave da API pública | Automation Engine | n8n › Settings › n8n API | Conforme seu plano n8n |
| `OPENAI_API_KEY` + créditos da API | GPT no AI Engine | platform.openai.com (a assinatura ChatGPT não vale como crédito) | Pago por uso |
| Endpoints `/jarvis/*` ou workflows n8n em cada projeto | Central Executiva com dados reais | Implementar o Jarvis Connector Protocol | Desenvolvimento por projeto |

## IA (OpenAI) e voz premium (ElevenLabs)

Secrets das Edge Functions (Supabase → Edge Functions → Secrets). Nunca no app nem no GitHub.

| Secret | Obrigatória | Padrão | Uso |
|---|---|---|---|
| `OPENAI_API_KEY` | sim (IA) | — | Conversa, ferramentas e transcrição |
| `OPENAI_MODEL` | não | `gpt-5-mini` | Pedidos do dia a dia (rápido e barato) |
| `OPENAI_MODEL_COMPLEX` | não | `gpt-5` | Pedidos complexos |
| `ELEVENLABS_API_KEY` | sim (voz premium) | — | Função `tts` (voz em streaming) |
| `ELEVENLABS_VOICE_ID` | não | `JBFqnCBsd6RMkjVDRZzb` ("George", britânico) | Identidade vocal do JARVIS |
| `ELEVENLABS_MODEL` | não | `eleven_flash_v2_5` | Baixa latência, fala português |
| `ELEVENLABS_DAILY_CHARS` | não | `20000` | Limite diário por usuário |

Sem `ELEVENLABS_API_KEY`, o app usa automaticamente a voz do navegador.
