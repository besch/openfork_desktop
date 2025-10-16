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
  services: Array<{ value: string; label: string; }>;
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
}

export const useClientStore = create<DGNClientState>((set, get) => ({
  status: "stopped",
  logs: [],
  stats: { pending: 0, processing: 0, completed: 0, failed: 0 },
  providerId: null,
  theme: "dark",
  session: null,
  jobSubscription: null,
  services: [{ value: "auto", label: "Auto-Select" }], // Start with a default
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
  setSession: async (session) => {
    // Update the auth state of the renderer's Supabase client instance.
    if (session) {
      await supabase.auth.setSession({
        access_token: session.access_token,
        refresh_token: session.refresh_token,
      });
    } else {
      // Clear the client-side session.
      await supabase.auth.signOut();
    }

    const { subscribeToJobChanges, unsubscribeFromJobChanges, fetchServices } = get();

    // Await the unsubscribe call to prevent race conditions.
    await unsubscribeFromJobChanges();

    set({ session });

    if (session) {
      subscribeToJobChanges();
      fetchServices(); // Fetch services when user is logged in
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
      // Keep the default service list on error
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
      set({ stats: { pending: 0, processing: 0, completed: 0, failed: 0 } });
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
          fetchStats(); // Fetch initial stats
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