import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@primer/primitives/dist/css/functional/themes/light.css';
import '@primer/primitives/dist/css/functional/themes/dark.css';
import '@fontsource-variable/literata/index.css';
import '@fontsource-variable/literata/wght-italic.css';
import '@fontsource-variable/source-code-pro/index.css';
import '@fontsource-variable/source-code-pro/wght-italic.css';
import '@fontsource-variable/jetbrains-mono/index.css';
import '@fontsource-variable/jetbrains-mono/wght-italic.css';
import '@/client/styles/diff.css';
import '@/client/ui/ui.css';
import '@/client/styles/app.css';
import '@/client/styles/themes.css';
import { App } from '@/client/app.js';
import { applyFonts } from '@/client/lib/fonts.js';
import { applyTheme, watchSystemTheme } from '@/client/lib/theme.js';
import { prefs } from '@/client/store/prefs.js';

const params = new URLSearchParams(location.search);
const modeParam = params.get('mode');
const appearance =
  modeParam === 'light' || modeParam === 'dark'
    ? modeParam
    : prefs.appearance();
applyTheme(prefs.theme(), appearance);
applyFonts(prefs.proseFont(), prefs.codeFont());
watchSystemTheme(() => applyTheme(prefs.theme(), prefs.appearance()));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
