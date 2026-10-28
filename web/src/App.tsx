import { useEffect } from 'react';
import { Center, Loader } from '@mantine/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Navigate, Route, Routes } from 'react-router-dom';
import { api } from './lib/api';
import { AppStateProvider } from './lib/app-state';
import { setHideCents } from './lib/format';
import { useSettings, useUsers } from './lib/queries';
import { Layout } from './components/Layout';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { TransactionsPage } from './pages/TransactionsPage';
import { AccountsPage } from './pages/AccountsPage';
import { BalancesPage } from './pages/BalancesPage';
import { BudgetsPage } from './pages/BudgetsPage';
import { GoalsPage } from './pages/GoalsPage';
import { ReportsPage } from './pages/ReportsPage';
import { ImportPage } from './pages/ImportPage';
import { StatementsPage } from './pages/StatementsPage';
import { RulesPage } from './pages/RulesPage';
import { RecurringPage } from './pages/RecurringPage';
import { ReviewPage } from './pages/ReviewPage';
import { SettingsPage } from './pages/SettingsPage';
import { ProfilesPage } from './pages/ProfilesPage';
import { DebtorsPage } from './pages/DebtorsPage';
import { PendingPaymentsPage } from './pages/PendingPaymentsPage';
import { ActivityPage } from './pages/ActivityPage';
import { WikiPage } from './wiki/WikiPage';

type Status = { needsSetup: boolean; user: { id: number; username: string; display_name: string; color: string } | null };

export function App() {
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ['auth'], queryFn: () => api.get<Status>('/auth/status'), staleTime: Infinity });

  useEffect(() => {
    const onUnauthorized = () => qc.invalidateQueries({ queryKey: ['auth'] });
    window.addEventListener('pfd:unauthorized', onUnauthorized);
    return () => window.removeEventListener('pfd:unauthorized', onUnauthorized);
  }, [qc]);

  if (status.isLoading) {
    return (
      <Center h="100vh">
        <Loader />
      </Center>
    );
  }
  if (!status.data?.user) return <LoginPage setup={!!status.data?.needsSetup} />;
  return <Authed me={status.data.user} />;
}

function Authed({ me }: { me: NonNullable<Status['user']> }) {
  const users = useUsers();
  const settings = useSettings();
  if (!users.data || !settings.data) {
    return (
      <Center h="100vh">
        <Loader />
      </Center>
    );
  }
  // Every amount is formatted through money(), which reads this; the key redraws the screens when it changes.
  setHideCents(settings.data.hide_cents);
  const cents = JSON.stringify(settings.data.hide_cents ?? null);
  return (
    <AppStateProvider me={me} users={users.data}>
      <Routes key={cents}>
        {/* The help wiki has its own screens, outside the app's frame. */}
        <Route path="/ayuda/*" element={<WikiPage />} />
        <Route path="*" element={<AppScreens />} />
      </Routes>
    </AppStateProvider>
  );
}

function AppScreens() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/movimientos" element={<TransactionsPage />} />
        <Route path="/cuentas" element={<AccountsPage />} />
        <Route path="/saldos" element={<BalancesPage />} />
        <Route path="/presupuestos" element={<BudgetsPage />} />
        <Route path="/metas" element={<GoalsPage />} />
        <Route path="/reportes" element={<ReportsPage />} />
        <Route path="/importar" element={<ImportPage />} />
        <Route path="/resumenes" element={<StatementsPage />} />
        <Route path="/reglas" element={<RulesPage />} />
        <Route path="/recurrentes" element={<RecurringPage />} />
        <Route path="/cierre" element={<ReviewPage />} />
        <Route path="/ajustes" element={<SettingsPage />} />
        <Route path="/perfiles" element={<ProfilesPage />} />
        <Route path="/actividad" element={<ActivityPage />} />
        <Route path="/deudores" element={<DebtorsPage />} />
        <Route path="/pendientes" element={<PendingPaymentsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
