/**
 * @fileoverview Browser entry point.
 */

import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';

import {App} from './app.js';
import {ThemeProvider} from '@/components/theme';
import {Toaster} from '@/components/ui/sonner';
import {TooltipProvider} from '@/components/ui/tooltip';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <TooltipProvider delayDuration={200}>
        <App />
        <Toaster position="bottom-right" richColors closeButton />
      </TooltipProvider>
    </ThemeProvider>
  </StrictMode>
);
