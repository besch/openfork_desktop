import { create } from "zustand";
import type { Session, RealtimeChannel } from "@supabase/supabase-js";
import type {
  DGNClientStatus,
  LogEntry,
  JobStats,
  Project,
  JobPolicy,
} from "./types";
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
  projects: Project[];
  selectedProjects: Project[];
  isLoading: boolean;
  jobPolicy: JobPolicy;
  allowedIds: string;
  setStatus: (status: DGNClientStatus) => void;
  addLog: (log: Omit<LogEntry, "timestamp">) => void;
  setStats: (stats: JobStats) => void;
  setProviderId: (id: string | null) => void;
  clearLogs: () => void;
  setTheme: (theme: Theme) => void;
  setSession: (session: Session | null) => Promise<void>;
  fetchStats: () => Promise<void>;
  fetchServices: () => Promise<void>;
  fetchProjects: (query: string) => Promise<void>;
  setSelectedProjects: (projects: Project[]) => void;
  subscribeToJobChanges: () => void;
  unsubscribeFromJobChanges: () => Promise<void>;
  setIsLoading: (loading: boolean) => void;
  setSubscriptionPolicy: (policy: JobPolicy, ids: string) => Promise<void>;
  setJobPolicy: (policy: JobPolicy) => void;
  loadPersistentSettings: () => Promise<void>;
  savePersistentSettings: () => Promise<void>;
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
  projects: [],
  selectedProjects: [],
  isLoading: true,
  jobPolicy: "mine",
  allowedIds: "",
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
  setJobPolicy: (policy) => set({ jobPolicy: policy }),
  setSelectedProjects: (projects) => set({ selectedProjects: projects }),
  setSubscriptionPolicy: async (policy, ids) => {
    await get().unsubscribeFromJobChanges();
    set({ jobPolicy: policy, allowedIds: ids });
    get().subscribeToJobChanges();
  },
  setSession: async (session) => {
    const currentSession = get().session;
    const isSameUser =
      currentSession?.user?.id === session?.user?.id && !!session;

    if (isSameUser && session) {
      // Just update the tokens without resetting subscriptions
      await supabase.auth.setSession({
        access_token: session.access_token,
        refresh_token: session.refresh_token,
      });
      supabase.realtime.setAuth(session.access_token);
      set({ session });
      // Refresh stats to ensure we're in sync, in case any requests failed during token expiry
      get().fetchStats();
      return;
    }

    // Always clean up the old subscription on any actual session change (login/logout/user switch).
    await get().unsubscribeFromJobChanges();

    // Update the Supabase client and the store's state.
    if (session) {
      await supabase.auth.setSession({
        access_token: session.access_token,
        refresh_token: session.refresh_token,
      });
      supabase.realtime.setAuth(session.access_token);
    } else {
      await supabase.auth.signOut({ scope: "local" });
      supabase.realtime.setAuth(null);
    }
    set({ session });

    // If it's a new login, set up the new subscription.
    if (session) {
      get().subscribeToJobChanges();
      get().fetchServices();
    }
  },
  fetchServices: async () => {
    try {
      const config: Record<string, { service_name: string; label: string }> =
        await window.electronAPI.fetchConfig();

      const serviceMap = new Map<string, string>();
      for (const workflow of Object.values(config)) {
        if (workflow.service_name && workflow.label) {
          serviceMap.set(workflow.service_name, workflow.label);
        }
      }

      const uiServices = Array.from(serviceMap.entries()).map(
        ([value, label]) => ({
          value,
          label,
        })
      );

      const services = [{ value: "auto", label: "Auto-Select" }, ...uiServices];

      set({ services });
    } catch (error) {
      console.error("Error fetching DGN services:", error);
    }
  },
  fetchProjects: async (query) => {
    if (!query) {
      set({ projects: [] });
      return;
    }
    try {
      const projects = await window.electronAPI.searchGeneral(query);
      set({ projects });
    } catch (error) {
      console.error("Error fetching projects:", error);
      set({ projects: [] });
    }
  },
  fetchStats: async () => {
    const { session, jobPolicy, allowedIds } = get();
    if (!session?.user) {
      set({ stats: { pending: 0, processing: 0, completed: 0, failed: 0 } });
      return;
    }
    try {
      const { data, error } = await supabase
        .rpc("fetch_dgn_job_stats_for_policy", {
          p_policy: jobPolicy,
          p_user_id: session.user.id,
          p_allowed_ids: allowedIds,
        })
        .single();

      if (error) throw error;

      if (data) {
        set({ stats: data as JobStats });
      }
    } catch (error) {
      console.error("store.ts: Error fetching stats:", error);
    }
  },
  subscribeToJobChanges: () => {
    const { session, fetchStats, jobSubscription, jobPolicy, allowedIds } =
      get();
    if (!session || !session.user || jobSubscription) {
      return;
    }

    // For project/users policies, don't subscribe if there are no IDs.
    if ((jobPolicy === "project" || jobPolicy === "users") && !allowedIds) {
      set({ stats: { pending: 0, processing: 0, completed: 0, failed: 0 } });
      // Ensure no lingering subscription
      get().unsubscribeFromJobChanges();
      return;
    }

    let channelName: string;
    let postgresChangesOptions: any;

    switch (jobPolicy) {
      case "mine":
        channelName = `dgn-jobs-user-changes:${session.user.id}`;
        postgresChangesOptions = {
          event: "*",
          schema: "public",
          table: "dgn_jobs",
          filter: `user_id=eq.${session.user.id}`,
        };
        break;
      case "project":
        channelName = `dgn-jobs-project-changes:${allowedIds
          .split(",")
          .sort()
          .join(",")}`;
        postgresChangesOptions = {
          event: "*",
          schema: "public",
          table: "dgn_jobs",
          filter: `project_id=in.(${allowedIds})`,
        };
        break;
      case "users":
        channelName = `dgn-jobs-users-changes:${allowedIds
          .split(",")
          .sort()
          .join(",")}`;
        postgresChangesOptions = {
          event: "*",
          schema: "public",
          table: "dgn_jobs",
          filter: `user_id=in.(${allowedIds})`,
        };
        break;
      case "all":
        channelName = "dgn-jobs-all-changes";
        postgresChangesOptions = {
          event: "*",
          schema: "public",
          table: "dgn_jobs",
        };
        break;
      default:
        // This case should not be reached if logic is correct
        return;
    }

    const channel = supabase
      .channel(channelName)
      .on("postgres_changes", postgresChangesOptions, () => {
        fetchStats();
      })
      .subscribe((status, err) => {
        if (status === "SUBSCRIBED") {
          // Fetch initial stats once subscribed.
          fetchStats();
        }
        if (err) {
          console.error(`store.ts: Subscription error on ${channelName}:`, err);
        }
      });
    set({ jobSubscription: channel });
  },
  unsubscribeFromJobChanges: async () => {
    const { jobSubscription } = get();
    if (jobSubscription) {
      await supabase.removeChannel(jobSubscription);
      set({ jobSubscription: null });
    }
  },
  loadPersistentSettings: async () => {
    try {
      const settings = await window.electronAPI.loadSettings();
      if (settings) {
        // Validate the loaded settings before applying them
        const validatedJobPolicy: JobPolicy = (
          ["all", "mine", "project", "users"] as JobPolicy[]
        ).includes(settings.jobPolicy as JobPolicy)
          ? (settings.jobPolicy as JobPolicy)
          : "mine";

        const validatedTheme: Theme = (
          ["dark", "light", "system"] as Theme[]
        ).includes(settings.theme as Theme)
          ? (settings.theme as Theme)
          : "dark";

        set({
          jobPolicy: validatedJobPolicy,
          theme: validatedTheme,
        });
        console.log("Loaded persistent settings:", settings);
      }
    } catch (error) {
      console.error("Error loading persistent settings:", error);
    }
  },
  savePersistentSettings: async () => {
    try {
      const { jobPolicy, theme } = get();
      await window.electronAPI.saveSettings({
        jobPolicy,
        theme,
      });
      console.log("Saved persistent settings:", { jobPolicy, theme });
    } catch (error) {
      console.error("Error saving persistent settings:", error);
    }
  },
}));

function initializeIpcListeners() {
  const { setStatus, addLog, setSession, setIsLoading } =
    useClientStore.getState();

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
    setIsLoading(false);
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
