import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@primer/primitives/dist/css/functional/themes/light.css';
import '@primer/primitives/dist/css/functional/themes/dark.css';
import '@/client/styles/diff.css';
import '@/client/ui/ui.css';
import '@/client/styles/app.css';
import { App } from '@/client/app.js';

const params = new URLSearchParams(location.search);
const mode = params.get('mode');
if (mode === 'light' || mode === 'dark')
  document.documentElement.setAttribute('data-color-mode', mode);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
