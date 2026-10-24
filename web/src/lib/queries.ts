import { useQuery, useQueryClient } from '@tanstack/react-query';
import { notifications } from '@mantine/notifications';
import { api } from './api';
import type { Account, Category, Me, Settings, User } from './types';

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
    for (const key of ['transactions', 'dashboard', 'accounts', 'budgets', 'balances', 'reports', 'goals', 'installments', 'tags', 'recurring', 'notifications', 'imports']) {
      qc.invalidateQueries({ queryKey: [key] });
    }
  };
}

export function notifyError(e: unknown) {
  notifications.show({ color: 'red', title: 'Error', message: e instanceof Error ? e.message : String(e) });
}

export function notifyOk(message: string) {
  notifications.show({ color: 'teal', message });
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

export function accountSelectData(accounts: Account[] | undefined, users: User[] | undefined, opts: { writableOnly?: boolean; includeArchived?: boolean } = {}) {
  if (!accounts) return [];
  const list = accounts.filter((a) => (opts.includeArchived || !a.archived) && (!opts.writableOnly || a.can_edit || !a.is_private));
  const groups: { group: string; items: { value: string; label: string }[] }[] = [];
  const add = (group: string, items: Account[]) => {
    if (items.length) groups.push({ group, items: items.map((a) => ({ value: String(a.id), label: `${a.name} (${a.currency})` })) });
  };
  add('Común', list.filter((a) => a.owner_id === null));
  for (const u of users ?? []) add(u.display_name, list.filter((a) => a.owner_id === u.id));
  return groups;
}
