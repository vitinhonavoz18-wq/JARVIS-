# Auditoria de renderização mobile — 20/11/2026

## Sintomas relatados
Faixas horizontais coloridas atravessando a tela, conteúdo central ilegível e regiões escuras no
celular (Android). A captura de tela não chegou anexada à mensagem; a investigação partiu dos
sintomas descritos e de medições no Chromium com emulação Android (412×915 @2,625 e 360×800 @3).

## Método (reproduzível)
- `node scripts/diagnose-render.mjs <url>` — camadas de composição da GPU (CDP LayerTree), memória,
  `backdrop-filter`, máscaras, validade do alpha pré-multiplicado do WebGL, erros e estouro lateral.
- `node scripts/diagnose-webgl-contexts.mjs <url>` — contextos WebGL criados/liberados em 40 navegações.
- Flags de isolamento: `?diag=nowebgl,noblur,nogrid,noglow,noanim` (combináveis, por sessão).
- `node scripts/visual-qa.mjs <url> [pasta]` — 14 telas × 6 tamanhos + estabilidade.

## Achados

| # | Achado | Evidência | Status |
|---|---|---|---|
| 1 | Conteúdo rolava dentro de um `<main>` interno; o Chrome o promoveu a *root scroller* implícito. O menu inferior **fixo com `backdrop-filter`** ficou marcado `AffectedByOuterViewportBoundsDelta` (redesenhado quando a barra de endereço aparece/some). | Razões de composição: `RootScroller, OverflowScrolling` / `FixedPosition, BackdropFilter, AffectedByOuterViewportBoundsDelta` | **Causa mais provável** das faixas (combinação com histórico de artefatos no Chromium Android). Corrigido. Não comprovado em hardware. |
| 2 | Camada de 412×2406 px criada só por sobreposição (`Overlap`) + 3 camadas de tela inteira; ~50–55 MB de composição | LayerTree | Corrigido: 1 camada de tela inteira, 24–28 MB (−52%) |
| 3 | `body::before` fixo de tela inteira com `mask-image` + 6 bordas com `-webkit-mask-composite` | 7 máscaras ativas | Corrigido: 0 máscaras |
| 4 | **Vazamento de contextos WebGL**: 2 contextos por visita (teste de suporte nunca liberado + núcleo sem `forceContextLoss`). O Chrome Android limita contextos ativos e descarta os antigos → tela preta/lixo após uso | 90 criados, 0 liberados em 40 navegações | Corrigido: 72/73 liberados, máx. 1 ativo |
| 5 | Sem tratamento de perda/restauração de contexto WebGL | — | Corrigido: fallback CSS imediato e retorno automático (testado com `WEBGL_lose_context`) |
| 6 | Pixels do WebGL fora do formato pré-multiplicado | 0 inválidos em ~79 mil | **Hipótese descartada** (shader agora pré-multiplica explicitamente e limita cores) |
| 7 | Núcleo 3D desenhando 60 fps continuamente e iniciando antes do conteúdo | TBT 7,2 s | Corrigido: inicia ocioso, 30–45 fps parado, para fora da tela/segundo plano |
| 8 | Cartões transbordando a tela em 360–412 px (Início, Central Executiva, Automation Studio, AI Engine) | Elementos com `right` > largura do aparelho | Corrigido: grades com `minmax(0,1fr)` |
| 9 | Texto visível através das barras fixas (96% opacas) | Captura 360×800 | Corrigido: barras 100% opacas |
| 10 | Horário livre de 2 min exibido ("19h58–20h") | Captura | Corrigido + teste |
| 11 | Após deploy, aba antiga podia pedir arquivo inexistente (tela branca) e o cache do SW nunca mudava de versão | Revisão do código | Corrigido: recarga automática única, cache versionado por build, aviso de nova versão |

## Medições (Lighthouse 13.6, celular emulado; mediana de 3)
| Métrica | Antes | Depois |
|---|---|---|
| Nota | 47 | 70 |
| LCP | 5,8 s | 4,0 s |
| TBT | 7,2 s | 0,64 s |
| CLS | 0,053 | 0 |
| TTI | 13,9 s | 4,8 s |

## Riscos remanescentes
- Não houve aparelho Android físico: a eliminação das faixas não está comprovada no hardware do usuário.
  Se persistirem: Configurações → Qualidade visual → **Econômica** e informar modelo/navegador.
- O navegador de testes usa GPU por software (SwiftShader); medições de fps/TBT não representam GPU real.
