import { create } from "zustand";
import type { Session, RealtimeChannel } from "@supabase/supabase-js";
import type { DGNClientStatus, LogEntry, JobStats } from "./types";
import { supabase } from "./supabase";

const MAX_LOGS = 500;

type Theme = "dark" | "light" | "system";

interface DGNClientState {
  status: DGNClientStatus;
  logs: LogEntry[];
  stats: JobStats;
  providerId: string | null;
  theme: Theme;
  session: Session | null;
  jobSubscription: RealtimeChannel | null;
  services: Array<{ value: string; label: string }>;
  isLoading: boolean;
  setStatus: (status: DGNClientStatus) => void;
  addLog: (log: Omit<LogEntry, "timestamp">) => void;
  setStats: (stats: JobStats) => void;
  setProviderId: (id: string | null) => void;
  clearLogs: () => void;
  setTheme: (theme: Theme) => void;
  setSession: (session: Session | null) => Promise<void>;
  fetchStats: () => Promise<void>;
  fetchServices: () => Promise<void>;
  subscribeToJobChanges: () => void;
  unsubscribeFromJobChanges: () => Promise<void>;
  setIsLoading: (loading: boolean) => void;
}

export const useClientStore = create<DGNClientState>((set, get) => ({
  status: "stopped",
  logs: [],
  stats: { pending: 0, processing: 0, completed: 0, failed: 0 },
  providerId: null,
  theme: "dark",
  session: null,
  jobSubscription: null,
  services: [{ value: "auto", label: "Auto-Select" }],
  isLoading: true,
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
  setIsLoading: (loading) => set({ isLoading: loading }),
  setSession: async (session) => {
    if (session) {
      await supabase.auth.setSession({
        access_token: session.access_token,
        refresh_token: session.refresh_token,
      });
    } else {
      await supabase.auth.signOut();
    }

    const { subscribeToJobChanges, unsubscribeFromJobChanges, fetchServices } =
      get();
    await unsubscribeFromJobChanges();
    set({ session });

    if (session) {
      subscribeToJobChanges();
      fetchServices();
    }
  },
  fetchServices: async () => {
    try {
      const apiUrl = await window.electronAPI.getOrchestratorApiUrl();
      const response = await fetch(`${apiUrl}/api/dgn/config`);
      if (!response.ok) {
        throw new Error(`Failed to fetch DGN config: ${response.statusText}`);
      }
      const config = await response.json();
      if (config?.ui_services) {
        set({ services: config.ui_services });
      }
    } catch (error) {
      console.error("Error fetching DGN services:", error);
    }
  },
  fetchStats: async () => {
    const { session } = get();
    if (!session?.user) {
      set({ stats: { pending: 0, processing: 0, completed: 0, failed: 0 } });
      return;
    }
    try {
      const { data, error } = await supabase
        .rpc("fetch_dgn_job_stats", { p_user_id: session.user.id })
        .single();
      if (error) throw error;
      if (data) {
        set({ stats: data as JobStats });
      }
    } catch (error) {
      console.error("Error fetching stats:", error);
    }
  },
  subscribeToJobChanges: () => {
    const { session, fetchStats, jobSubscription } = get();
    if (!session || !session.user || jobSubscription) return;
    const channel = supabase
      .channel("dgn-jobs-user-changes")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "dgn_jobs",
          filter: `user_id=eq.${session.user.id}`,
        },
        (payload) => {
          console.log("DGN job change received, refetching stats.", payload);
          fetchStats();
        }
      )
      .subscribe((status, err) => {
        if (status === "SUBSCRIBED") {
          console.log("Subscribed to DGN job changes.");
          fetchStats();
        }
        if (err) console.error("Error subscribing to job changes:", err);
      });
    set({ jobSubscription: channel });
  },
  unsubscribeFromJobChanges: async () => {
    const { jobSubscription } = get();
    if (jobSubscription) {
      await jobSubscription.unsubscribe();
      set({ jobSubscription: null });
      console.log("Unsubscribed from DGN job changes.");
    }
  },
}));

// --- Centralized IPC Listener Setup ---
function initializeIpcListeners() {
  console.log("store.ts: Setting up Electron API listeners.");
  const { setStatus, addLog, setSession, setIsLoading } =
    useClientStore.getState();

  // These listeners are now set up once and for all.
  window.electronAPI.onStatusChange((status) => {
    setStatus(status);
    if (status === "stopping") {
      window.electronAPI.setWindowClosable(false);
    } else {
      window.electronAPI.setWindowClosable(true);
    }
  });

  window.electronAPI.onLog(addLog);

  window.electronAPI.onSession(async (session) => {
    await setSession(session);
    setIsLoading(false); // Signal that initial session check is done
  });

  window.electronAPI.onAuthCallback(async (url) => {
    const hashPart = url.split("#")[1];
    if (!hashPart) return;

    const params = new URLSearchParams(hashPart);
    const accessToken = params.get("access_token");
    const refreshToken = params.get("refresh_token");

    if (accessToken && refreshToken) {
      const { session: newSession, error } =
        await window.electronAPI.setSessionFromTokens(
          accessToken,
          refreshToken
        );

      if (error) {
        console.error(
          "Error persisting session in main process:",
          error.message
        );
        return;
      }
      if (newSession) {
        await setSession(newSession);
      }
    }
  });
}

initializeIpcListeners();