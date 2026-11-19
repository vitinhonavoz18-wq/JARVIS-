# Guia mobile (Android e iOS)

O JARVIS usa **Capacitor** para empacotar o mesmo app web como aplicativo nativo.

## Opção rápida: instalar como app (PWA)

No celular, abra o site publicado → menu do navegador → **Adicionar à tela inicial**.
Funciona offline para abrir o app, com navegação inferior e áreas seguras respeitadas.
Push no iPhone via PWA exige iOS 16.4+ e o app adicionado à tela inicial.

## App nativo

Pré-requisitos: Android Studio (Android) e/ou Mac com Xcode (iOS).

```bash
npm run build
```

```bash
npx cap add android
```

```bash
npx cap sync
```

```bash
npx cap open android
```

Para iOS, troque `android` por `ios` (somente em Mac).

### Notificações no celular

1. Crie um projeto no Firebase, adicione o app Android (`com.franklinvitor.jarvisfv`) e baixe `google-services.json`
   para `android/app/`. No iOS, configure a chave APNs no Firebase.
2. Em **Configurações do projeto → Contas de serviço**, gere uma chave JSON e configure:
   `supabase secrets set FCM_SERVICE_ACCOUNT='conteúdo-do-json'`
3. Os lembretes também são **agendados localmente no aparelho** (`@capacitor/local-notifications`), então tocam
   mesmo sem internet no horário.

### Limitações honestas por plataforma

| Recurso | Android | iOS |
|---|---|---|
| Lembrete com app fechado | ✅ push + notificação local | ✅ push + notificação local |
| Palavra “Jarvis” com app fechado/tela bloqueada | ❌ o sistema não permite sem serviço de primeiro plano dedicado | ❌ não permitido pela Apple |
| Comando de voz sem abrir o app | ✅ app HTTP Shortcuts (widget); “Ok Google” só com Tasker | ✅ app Atalhos + “E aí Siri, Jarvis” |
| Compartilhar texto de outro app para o JARVIS | ✅ (PWA instalado) | ⚠ o iOS ainda não oferece “compartilhar para” em PWA |
