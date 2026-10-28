import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import { notifyOk } from './queries';

export type ProfileInfo = { id: number; name: string; is_default: boolean; created_at: string; transactions: number; accounts: number };
export type ProfilesResponse = { profiles: ProfileInfo[]; current: number | null };

export const useProfiles = () => useQuery({ queryKey: ['profiles'], queryFn: () => api.get<ProfilesResponse>('/profiles'), staleTime: 60_000 });

/**
 * Switching profile changes every number on screen: you stay on the same page, what it shows is
 * refetched from the new profile, and cached data from other pages is dropped so it can't show up.
 */
export function useSelectProfile() {
  const qc = useQueryClient();
  return async (id: number, name: string) => {
    await api.post('/profiles/select', { id });
    qc.removeQueries({ type: 'inactive' });
    await qc.invalidateQueries({ type: 'active' });
    notifyOk(`Perfil «${name}» en uso`);
  };
}

