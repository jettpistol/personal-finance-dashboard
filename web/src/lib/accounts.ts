import { useQuery, type QueryClient } from '@tanstack/react-query';
import { api } from './api';
import { notifyError, notifyOk } from './queries';

/** A user logged in on this browser; `active` is the one the app is using now. */
export type LoggedAccount = { id: number; username: string; display_name: string; color: string; active: boolean };

// Under ['auth'] so anything that refreshes the current user refreshes this list too.
export const useLoggedAccounts = () =>
  useQuery({ queryKey: ['auth', 'accounts'], queryFn: () => api.get<LoggedAccount[]>('/auth/accounts'), staleTime: 60_000 });

/**
 * After the active user changes: you stay on the same page, what it shows is refetched as the new
 * user (the ['auth'] query holds the current user), and cached data of other pages is dropped.
 */
export async function refreshAsNewUser(qc: QueryClient) {
  qc.removeQueries({ type: 'inactive' });
  await qc.invalidateQueries();
}

export async function switchAccount(qc: QueryClient, account: Pick<LoggedAccount, 'id' | 'display_name'>) {
  try {
    await api.post('/auth/switch', { user_id: account.id });
  } catch (e) {
    notifyError(e);
    qc.invalidateQueries({ queryKey: ['auth', 'accounts'] });
    return;
  }
  await refreshAsNewUser(qc);
  notifyOk(`Ahora estás como ${account.display_name}`);
}

/** Logs out the active user (or everyone with `all`). If another account stays logged in, the app continues as it. */
export async function logoutAccount(qc: QueryClient, all = false) {
  const r = await api.post<{ user: { display_name: string } | null }>('/auth/logout', all ? { all: true } : {});
  if (r.user) {
    await refreshAsNewUser(qc);
    notifyOk(`Ahora estás como ${r.user.display_name}`);
    return;
  }
  // Nobody left: drop everyone's cached data and refetch the status, which shows the login page.
  // (qc.clear() would also drop the ['auth'] query, and nothing would refetch it.)
  qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'auth' });
  await qc.invalidateQueries({ queryKey: ['auth'] });
}
