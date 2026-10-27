import '@mantine/core/styles.css';
import '@mantine/dates/styles.css';
import '@mantine/notifications/styles.css';
import '@mantine/charts/styles.css';
import '@fontsource-variable/source-sans-3';
import '@fontsource/cascadia-code/400.css';
import '@fontsource/cascadia-code/600.css';
import './styles.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { MantineProvider } from '@mantine/core';
import { DatesProvider } from '@mantine/dates';
import { Notifications } from '@mantine/notifications';
import { ModalsProvider } from '@mantine/modals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat';

// Lets date fields read what people type in their display format (e.g. 27/11/2026), not only picks.
dayjs.extend(customParseFormat);
import { App } from './App';
import { theme } from './theme';
import './lib/format';
import { installDropdownResize } from './lib/dropdown-resize';

installDropdownResize();

// Switches toggle only from the lever itself: a click on the text next to it must not act as
// a click on the control (the browser's default for <label>).
document.addEventListener(
  'click',
  (e) => {
    if ((e.target as HTMLElement | null)?.closest?.('.mantine-Switch-labelWrapper')) e.preventDefault();
  },
  true,
);

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: true, staleTime: 15_000 } },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <MantineProvider theme={theme} defaultColorScheme="light">
        <DatesProvider settings={{ locale: 'es', firstDayOfWeek: 1 }}>
          <ModalsProvider labels={{ confirm: 'Confirmar', cancel: 'Cancelar' }}>
            <Notifications position="top-right" />
            <BrowserRouter>
              <App />
            </BrowserRouter>
          </ModalsProvider>
        </DatesProvider>
      </MantineProvider>
    </QueryClientProvider>
  </StrictMode>,
);
