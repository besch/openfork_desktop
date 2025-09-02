import { create } from 'zustand';
import type { Session } from '@supabase/supabase-js';
import type { DGNClientStatus, LogEntry, JobStats } from './types';

const MAX_LOGS = 500;

type Theme = 'dark' | 'light' | 'system';

interface DGNClientState {
  status: DGNClientStatus;
  logs: LogEntry[];
  stats: JobStats;
  providerId: string | null;
  theme: Theme;
  session: Session | null;
  setStatus: (status: DGNClientStatus) => void;
  addLog: (log: Omit<LogEntry, 'timestamp'>) => void;
  setStats: (stats: JobStats) => void;
  setProviderId: (id: string | null) => void;
  clearLogs: () => void;
  setTheme: (theme: Theme) => void;
  setSession: (session: Session | null) => void;
}

export const useClientStore = create<DGNClientState>((set, get) => ({
  status: 'stopped',
  logs: [],
  stats: { pending: 0, processing: 0, completed: 0, failed: 0 },
  providerId: null,
  theme: 'dark',
  session: null,
  setStatus: (status) => set({ status }),
  addLog: (log) => {
    const newLog: LogEntry = {
      ...log,
      timestamp: new Date().toLocaleTimeString(),
    };
    set((state) => ({
      logs: [newLog, ...state.logs].slice(0, MAX_LOGS),
    }));
  },
  setStats: (stats) => set({ stats }),
  setProviderId: (id) => set({ providerId: id }),
  clearLogs: () => set({ logs: [] }),
  setTheme: (theme) => set({ theme }),
  setSession: (session) => set({ session }),
}));