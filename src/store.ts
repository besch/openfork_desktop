import { create } from "zustand";
import type { DGNClientStatus, LogEntry, JobStats } from "./types";

const MAX_LOGS = 500;

type Theme = "dark" | "light" | "system";

interface DGNClientState {
  status: DGNClientStatus;
  logs: LogEntry[];
  stats: JobStats;
  providerId: string | null;
  theme: Theme;
  setStatus: (status: DGNClientStatus) => void;
  addLog: (log: Omit<LogEntry, "timestamp">) => void;
  setStats: (stats: JobStats) => void;
  setProviderId: (id: string | null) => void;
  clearLogs: () => void;
  setTheme: (theme: Theme) => void;
}

export const useClientStore = create<DGNClientState>((set, get) => ({
  status: "stopped",
  logs: [],
  stats: { pending: 0, processing: 0, completed: 0, failed: 0 },
  providerId: null,
  theme: "dark",
  setStatus: (status) => set({ status }),
  addLog: (log) => {
    const newLog: LogEntry = {
      ...log,
      timestamp: new Date().toLocaleTimeString(),
    };
    set((state) => ({
      logs: [newLog, ...state.logs].slice(0, MAX_LOGS),
    }));

    // A bit of a hack to extract the provider ID from the logs
    if (
      log.type === "stdout" &&
      log.message.includes("Successfully registered with the Orchestrator")
    ) {
      const match = log.message.match(/Provider ID: (\S+)/);
      if (match && match[1]) {
        set({ providerId: match[1] });
      }
    }
  },
  setStats: (stats) => set({ stats }),
  setProviderId: (id) => set({ providerId: id }),
  clearLogs: () => set({ logs: [] }),
  setTheme: (theme) => set({ theme }),
}));
