import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { registerServiceWorker } from './lib/notifications.ts';
import { applyGraphics } from './lib/graphics.ts';
import { startVitals } from './lib/vitals.ts';

// Qualidade gráfica aplicada antes do primeiro desenho (evita trocar efeitos com a tela já visível).
applyGraphics();

// Após um novo deploy, uma aba aberta pode pedir um arquivo antigo que não existe mais.
// Em vez de tela branca, recarrega uma única vez para buscar a versão atual.
window.addEventListener('vite:preloadError', (event) => {
  const key = 'jarvis:chunk-reload';
  const last = Number(sessionStorage.getItem(key) ?? 0);
  if (Date.now() - last > 30_000) {
    event.preventDefault();
    sessionStorage.setItem(key, String(Date.now()));
    location.reload();
  }
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

registerServiceWorker();
startVitals();
