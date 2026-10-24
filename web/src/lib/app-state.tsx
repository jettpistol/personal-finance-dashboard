import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Currency, Scope, User } from './types';

type AppState = {
  me: { id: number; username: string; display_name: string; color: string };
  users: User[];
  partner: User | null;
  scope: Scope;
  setScope: (s: Scope) => void;
  currency: Currency;
  setCurrency: (c: Currency) => void;
  /** Opens the add/edit transaction modal from anywhere. */
  openTx: (opts?: TxModalOptions) => void;
  txModal: TxModalOptions | null;
  closeTx: () => void;
};

export type TxModalOptions = { id?: number; type?: 'expense' | 'income' | 'transfer' | 'adjustment'; accountId?: number; installments?: boolean };

const Ctx = createContext<AppState | null>(null);

function stored<T extends string>(key: string, fallback: T): T {
  try {
    return (localStorage.getItem(key) as T) || fallback;
  } catch {
    return fallback;
  }
}

function store(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode */
  }
}

export function AppStateProvider({ me, users, children }: { me: AppState['me']; users: User[]; children: ReactNode }) {
  const [scope, setScopeRaw] = useState<Scope>(() => stored<Scope>('pfd.scope', 'household'));
  const [currency, setCurrencyRaw] = useState<Currency>(() => stored<Currency>('pfd.currency', 'ARS'));
  const [txModal, setTxModal] = useState<TxModalOptions | null>(null);

  // A stored scope may point at a partner who later made their dashboard private.
  useEffect(() => {
    if (scope === 'household') return;
    const uid = Number(scope.slice(5));
    const u = users.find((x) => x.id === uid);
    if (!u || (uid !== me.id && !u.share_dashboard)) setScopeRaw('household');
  }, [scope, users, me.id]);

  const value = useMemo<AppState>(
    () => ({
      me,
      users,
      partner: users.find((u) => u.id !== me.id) ?? null,
      scope,
      setScope: (s) => {
        setScopeRaw(s);
        store('pfd.scope', s);
      },
      currency,
      setCurrency: (c) => {
        setCurrencyRaw(c);
        store('pfd.currency', c);
      },
      openTx: (opts) => setTxModal(opts ?? {}),
      txModal,
      closeTx: () => setTxModal(null),
    }),
    [me, users, scope, currency, txModal],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp outside provider');
  return v;
}

export function scopeName(scope: Scope, users: User[], meId: number): string {
  if (scope === 'household') return 'Hogar';
  const uid = Number(scope.slice(5));
  if (uid === meId) return 'Mis finanzas';
  return users.find((u) => u.id === uid)?.display_name ?? 'Personal';
}
