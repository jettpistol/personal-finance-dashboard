import { createElement } from 'react';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { notifications } from '@mantine/notifications';
import { ApiError, api, takeUndoTokens } from './api';
import type { Account, Category, Currency, Me, Settings, User } from './types';

export const useMe = () => useQuery({ queryKey: ['me'], queryFn: () => api.get<Me>('/me') });
export const useUsers = () => useQuery({ queryKey: ['users'], queryFn: () => api.get<User[]>('/users'), staleTime: 60_000 });
export const useAccounts = () => useQuery({ queryKey: ['accounts'], queryFn: () => api.get<Account[]>('/accounts') });
export const useCategories = () => useQuery({ queryKey: ['categories'], queryFn: () => api.get<Category[]>('/categories'), staleTime: 60_000 });
export const useSettings = () => useQuery({ queryKey: ['settings'], queryFn: () => api.get<Settings>('/settings') });
export const useTags = () => useQuery({ queryKey: ['tags'], queryFn: () => api.get<string[]>('/tags') });

/** Invalidates everything derived from transactions after a write. */
export function useRefreshData() {
  const qc = useQueryClient();
  return () => {
    for (const key of ['transactions', 'dashboard', 'accounts', 'budgets', 'balances', 'reports', 'goals', 'installments', 'tags', 'recurring', 'notifications', 'imports', 'pending', 'loans']) {
      qc.invalidateQueries({ queryKey: [key] });
    }
  };
}

/** A form error that also names the fields to paint red. */
export class FieldError extends Error {
  constructor(
    message: string,
    public fields: string[],
  ) {
    super(message);
  }
}

/** Fields an error is about: from a FieldError, or from the API's `fields`. */
export function errorFields(e: unknown): string[] {
  if (e instanceof FieldError) return e.fields;
  if (e instanceof ApiError) return (e.data as { fields?: string[] } | undefined)?.fields ?? [];
  return [];
}

export function notifyError(e: unknown) {
  notifications.show({ color: 'red', title: 'Error', message: e instanceof Error ? e.message : String(e) });
}

// Confirmations show at the bottom of the page. When the action can be undone (the server
// answered with an undo token, see api.ts), the toast carries a bold «Deshacer» for a few seconds.
const OK_POSITION = 'bottom-center' as const;
let undoClient: QueryClient | null = null;
let toastSeq = 0;

/** main.tsx hands over the app's QueryClient, so an undo can refresh every screen. */
export function setUndoQueryClient(qc: QueryClient) {
  undoClient = qc;
}

export function notifyOk(message: string) {
  const tokens = takeUndoTokens();
  if (!tokens.length) {
    notifications.show({ color: 'teal', message, position: OK_POSITION, className: 'pfd-toast-ok' });
    return;
  }
  const id = `pfd-undo-${++toastSeq}`;
  notifications.show({
    id,
    color: 'teal',
    position: OK_POSITION,
    autoClose: 7000,
    className: 'pfd-toast-ok pfd-toast-undo',
    message: createElement(
      'span',
      { className: 'pfd-undo-line' },
      createElement('span', null, message),
      ' ',
      createElement('button', { type: 'button', className: 'pfd-undo-btn', onClick: () => void runUndo(id, tokens) }, 'Deshacer'),
    ),
  });
}

/** Undoes the actions behind a toast (newest first) and refreshes everything. */
async function runUndo(id: string, tokens: string[]) {
  notifications.update({ id, message: 'Deshaciendo…', loading: true, autoClose: false, withCloseButton: false, className: 'pfd-toast-ok' });
  try {
    for (const t of tokens) await api.post(`/undo/${t}`);
    notifications.update({ id, color: 'teal', message: 'Deshecho', loading: false, autoClose: 3000, withCloseButton: true });
  } catch (e) {
    notifications.update({ id, color: 'red', message: e instanceof Error ? e.message : String(e), loading: false, autoClose: 6000, withCloseButton: true });
  } finally {
    void undoClient?.invalidateQueries();
  }
}

/** Category helpers: names with parent prefix, and grouped select data. */
export function categoryLabel(cats: Category[] | undefined, id: number | null | undefined): string {
  if (id == null || !cats) return 'Sin categoría';
  const c = cats.find((x) => x.id === id);
  if (!c) return 'Sin categoría';
  const parent = c.parent_id ? cats.find((x) => x.id === c.parent_id) : null;
  return parent ? `${parent.name} › ${c.name}` : c.name;
}

export function categoryColor(cats: Category[] | undefined, id: number | null | undefined): string {
  const c = cats?.find((x) => x.id === id);
  if (!c) return 'gray';
  if (c.color) return c.color;
  return cats?.find((x) => x.id === c.parent_id)?.color ?? 'gray';
}

export function categorySelectData(cats: Category[] | undefined, kind: 'expense' | 'income', opts: { parentsOnly?: boolean } = {}) {
  if (!cats) return [];
  const parents = cats.filter((c) => c.kind === kind && c.parent_id === null && !c.archived);
  return parents.map((p) => ({
    group: p.name,
    items: [
      { value: String(p.id), label: `${p.name} (general)` },
      ...(opts.parentsOnly ? [] : cats.filter((c) => c.parent_id === p.id && !c.archived).map((c) => ({ value: String(c.id), label: c.name }))),
    ],
  }));
}

export function accountSelectData(accounts: Account[] | undefined, users: User[] | undefined, opts: { writableOnly?: boolean; includeArchived?: boolean; currency?: Currency } = {}) {
  if (!accounts) return [];
  const list = accounts.filter(
    (a) => (opts.includeArchived || !a.archived) && (!opts.writableOnly || a.can_edit || !a.is_private) && (!opts.currency || a.currency === opts.currency),
  );
  const groups: { group: string; items: { value: string; label: string }[] }[] = [];
  const add = (group: string, items: Account[]) => {
    if (items.length) groups.push({ group, items: items.map((a) => ({ value: String(a.id), label: `${a.name} (${a.currency})` })) });
  };
  add('Común', list.filter((a) => a.owner_id === null));
  for (const u of users ?? []) add(u.display_name, list.filter((a) => a.owner_id === u.id));
  return groups;
}
