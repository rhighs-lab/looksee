import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@primer/primitives/dist/css/functional/themes/light.css';
import '@primer/primitives/dist/css/functional/themes/dark.css';
import '@fontsource-variable/literata/index.css';
import '@fontsource-variable/literata/wght-italic.css';
import '@/client/styles/diff.css';
import '@/client/ui/ui.css';
import '@/client/styles/app.css';
import '@/client/styles/themes.css';
import { App } from '@/client/app.js';
import { applyTheme, watchSystemTheme } from '@/client/lib/theme.js';
import { prefs } from '@/client/store/prefs.js';

const params = new URLSearchParams(location.search);
const modeParam = params.get('mode');
const appearance =
  modeParam === 'light' || modeParam === 'dark'
    ? modeParam
    : prefs.appearance();
applyTheme(prefs.theme(), appearance);
watchSystemTheme(() => applyTheme(prefs.theme(), prefs.appearance()));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
