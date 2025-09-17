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
  setStatus: (status: DGNClientStatus) => void;
  addLog: (log: Omit<LogEntry, "timestamp">) => void;
  setStats: (stats: JobStats) => void;
  setProviderId: (id: string | null) => void;
  clearLogs: () => void;
  setTheme: (theme: Theme) => void;
  setSession: (session: Session | null) => void;
  fetchStats: () => Promise<void>;
  subscribeToJobChanges: () => void;
  unsubscribeFromJobChanges: () => void;
}

export const useClientStore = create<DGNClientState>((set, get) => ({
  status: "stopped",
  logs: [],
  stats: { pending: 0, processing: 0, completed: 0, failed: 0 },
  providerId: null,
  theme: "dark",
  session: null,
  jobSubscription: null,
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
  setSession: (session) => {
    // When session changes, automatically manage the real-time subscription
    const { subscribeToJobChanges, unsubscribeFromJobChanges } = get();
    // Unsubscribe from any existing channel before setting the new session
    unsubscribeFromJobChanges();
    set({ session });
    // If there's a new session, subscribe to its changes
    if (session) {
      subscribeToJobChanges();
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

    const subscription = supabase
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
    set({ jobSubscription: subscription });
  },
  unsubscribeFromJobChanges: () => {
    const { jobSubscription } = get();
    if (jobSubscription) {
      jobSubscription.unsubscribe();
      set({ jobSubscription: null });
      console.log("Unsubscribed from DGN job changes.");
    }
  },
}));
