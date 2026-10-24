import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from './api';
import { notifyOk } from './queries';

export type ProfileInfo = { id: number; name: string; is_default: boolean; created_at: string; transactions: number; accounts: number };
export type ProfilesResponse = { profiles: ProfileInfo[]; current: number | null };

export const useProfiles = () => useQuery({ queryKey: ['profiles'], queryFn: () => api.get<ProfilesResponse>('/profiles'), staleTime: 60_000 });

/** Switching profile changes every number on screen, so everything is reloaded from scratch. */
export function useSelectProfile() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  return async (id: number, name: string) => {
    await api.post('/profiles/select', { id });
    qc.clear();
    await qc.invalidateQueries();
    navigate('/');
    notifyOk(`Perfil «${name}» en uso`);
  };
}

