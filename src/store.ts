import { create } from "zustand";
import type { Session, RealtimeChannel } from "@supabase/supabase-js";
import type {
  DGNClientStatus,
  LogEntry,
  JobStats,
  Project,
  ProviderRoutingConfig,
  DockerPullProgress,
  DockerContainer,
  DependencyStatus,
  MonetizeWallet,
  AutoCompactStatus,
  DiskSpaceError,
  EngineSwitchNotice,
  ImageEvictedNotification,
  WslRecoveryStatus,
} from "./types";
import { DEFAULT_ROUTING_CONFIG } from "./types";
import { supabase } from "./supabase";

const MAX_LOGS = 500;
const SYSTEM_NOTICE_TTL_MS = 8000;
const IMAGE_NOTICE_TTL_MS = 6000;

// Simplified project type for search results
interface SearchProject {
  id: string;
  title: string;
}

interface DGNClientState {
  status: DGNClientStatus;
  logs: LogEntry[];
  stats: JobStats;
  providerId: string | null;
  session: Session | null;
  jobSubscription: RealtimeChannel | null;
  services: Array<{ value: string; label: string }>;
  projects: SearchProject[];
  selectedProjects: Project[];
  isLoading: boolean;
  routingConfig: ProviderRoutingConfig;
  dockerPullProgress: DockerPullProgress | null;
  dependencyStatus: DependencyStatus | null;
  dockerContainers: DockerContainer[];
  autoCompactStatus: AutoCompactStatus | null;
  wslRecoveryStatus: WslRecoveryStatus | null;
  diskSpaceError: DiskSpaceError | null;
  engineSwitchNotice: EngineSwitchNotice | null;
  imageEvictedNotification: ImageEvictedNotification | null;
  jobState: {
    status: "idle" | "processing";
    jobId: string | null;
    type: string | null;
  };
  setDockerPullProgress: (progress: DockerPullProgress | null) => void;
  setDockerContainers: (containers: DockerContainer[]) => void;
  setDependencyStatus: (status: DependencyStatus | null) => void;
  setAutoCompactStatus: (status: AutoCompactStatus | null) => void;
  setWslRecoveryStatus: (status: WslRecoveryStatus | null) => void;
  setDiskSpaceError: (error: DiskSpaceError | null) => void;
  setEngineSwitchNotice: (notice: EngineSwitchNotice | null) => void;
  setImageEvictedNotification: (
    notification: ImageEvictedNotification | null,
  ) => void;
  setStatus: (status: DGNClientStatus) => void;
  addLog: (log: Omit<LogEntry, "timestamp">) => void;
  setStats: (stats: JobStats) => void;
  setProviderId: (id: string | null) => void;
  clearLogs: () => void;
  setSession: (session: Session | null) => Promise<void>;
  fetchStats: () => Promise<void>;
  fetchServices: () => Promise<void>;
  fetchProjects: (query: string) => Promise<void>;
  setSelectedProjects: (projects: Project[]) => void;
  subscribeToJobChanges: () => void;
  unsubscribeFromJobChanges: () => Promise<void>;
  setIsLoading: (loading: boolean) => void;
  setRoutingConfig: (config: ProviderRoutingConfig) => Promise<void>;
  loadPersistentSettings: () => Promise<void>;
  savePersistentSettings: () => Promise<void>;
  setJobState: (state: {
    status: "idle" | "processing";
    jobId: string | null;
    type: string | null;
  }) => void;
  monetizeWallet: MonetizeWallet | null;
  fetchMonetizeWallet: () => Promise<void>;
}

interface JobRealtimeOptions {
  event: "*";
  schema: "public";
  table: "dgn_jobs";
  filter?: string;
}

interface JobStatusPayload {
  type:
    | "JOB_START"
    | "JOB_COMPLETE"
    | "JOB_FAILED"
    | "JOB_CLEARED"
    | "MONETIZE_JOB_COMPLETE";
  id?: string;
  workflow_type?: string | null;
  service_type?: string | null;
  status?: string | null;
}

type MonetizeWalletRpcRow = Partial<MonetizeWallet> & {
  pending_earnings_cents?: number;
  available_to_withdraw_cents?: number;
  total_earned_lifetime_cents?: number;
  total_withdrawn_cents?: number;
  prepaid_balance_cents?: number;
  total_purchased_cents?: number;
};

const createIdleJobState = (): DGNClientState["jobState"] => ({
  status: "idle",
  jobId: null,
  type: null,
});

function isJobStatusPayload(payload: unknown): payload is JobStatusPayload {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  const { type } = payload as { type?: unknown };
  return (
    type === "JOB_START" ||
    type === "JOB_COMPLETE" ||
    type === "JOB_FAILED" ||
    type === "JOB_CLEARED" ||
    type === "MONETIZE_JOB_COMPLETE"
  );
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
  routingConfig: DEFAULT_ROUTING_CONFIG,
  dockerPullProgress: null,
  dependencyStatus: null,
  dockerContainers: [],
  autoCompactStatus: null,
  wslRecoveryStatus: null,
  diskSpaceError: null,
  engineSwitchNotice: null,
  imageEvictedNotification: null,
  jobState: createIdleJobState(),
  monetizeWallet: null,
  setDockerPullProgress: (progress) => set({ dockerPullProgress: progress }),
  setDockerContainers: (containers: DockerContainer[]) =>
    set({ dockerContainers: containers }),
  setDependencyStatus: (status) => set({ dependencyStatus: status }),
  setAutoCompactStatus: (status) => set({ autoCompactStatus: status }),
  setWslRecoveryStatus: (status) => set({ wslRecoveryStatus: status }),
  setDiskSpaceError: (error) => set({ diskSpaceError: error }),
  setEngineSwitchNotice: (notice) => set({ engineSwitchNotice: notice }),
  setImageEvictedNotification: (notification) =>
    set({ imageEvictedNotification: notification }),
  setJobState: (state) => set({ jobState: state }),
  fetchMonetizeWallet: async () => {
    const { session } = get();
    if (!session?.user) return;
    try {
      const { data, error } = await supabase
        .rpc("get_monetize_wallet_summary", { p_user_id: session.user.id })
        .single();
      if (!error && data) {
        const walletRow = data as MonetizeWalletRpcRow;
        // Map RPC response (may use old _cents names) to new _millicents names
        const wallet = {
          ...walletRow,
          pending_earnings_millicents:
            walletRow.pending_earnings_millicents ??
            walletRow.pending_earnings_cents ??
            0,
          available_to_withdraw_millicents:
            walletRow.available_to_withdraw_millicents ??
            walletRow.available_to_withdraw_cents ??
            0,
          total_earned_lifetime_millicents:
            walletRow.total_earned_lifetime_millicents ??
            walletRow.total_earned_lifetime_cents ??
            0,
          total_withdrawn_millicents:
            walletRow.total_withdrawn_millicents ??
            walletRow.total_withdrawn_cents ??
            0,
          prepaid_balance_millicents:
            walletRow.prepaid_balance_millicents ??
            walletRow.prepaid_balance_cents ??
            0,
          total_purchased_millicents:
            walletRow.total_purchased_millicents ??
            walletRow.total_purchased_cents ??
            0,
        };
        set({ monetizeWallet: wallet as MonetizeWallet });
      }
    } catch (err) {
      console.error("store.ts: Error fetching monetize wallet:", err);
    }
  },
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
  setIsLoading: (loading) => set({ isLoading: loading }),
  setSelectedProjects: (projects) => set({ selectedProjects: projects }),
  setRoutingConfig: async (config) => {
    await get().unsubscribeFromJobChanges();
    set({ routingConfig: config });
    get().subscribeToJobChanges();
  },
  setSession: async (session) => {
    const currentSession = get().session;
    const isSameUser =
      currentSession?.user?.id === session?.user?.id && !!session;

    if (isSameUser && session) {
      // Just update the tokens without resetting subscriptions
      supabase.realtime.setAuth(session.access_token);
      await supabase.auth.setSession({
        access_token: session.access_token,
        refresh_token: session.refresh_token,
      });
      set({ session });
      // Refresh stats to ensure we're in sync, in case any requests failed during token expiry
      get().fetchStats();
      return;
    }

    // Always clean up the old subscription on any actual session change (login/logout/user switch).
    await get().unsubscribeFromJobChanges();

    // Update the Supabase client and the store's state.
    if (session) {
      supabase.realtime.setAuth(session.access_token);
      await supabase.auth.setSession({
        access_token: session.access_token,
        refresh_token: session.refresh_token,
      });
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
        }),
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
    const { session, routingConfig } = get();
    if (!session?.user) {
      set({ stats: { pending: 0, processing: 0, completed: 0, failed: 0 } });
      return;
    }
    // Derive legacy policy string for the RPC (stats function still uses it)
    const allowedIds = routingConfig.trustedIds.join(",");
    let statsPolicy: string;
    if (routingConfig.monetizeMode) {
      statsPolicy = "monetize";
    } else if (routingConfig.communityMode === "trusted_users") {
      statsPolicy = "users";
    } else if (routingConfig.communityMode === "trusted_projects") {
      statsPolicy = "project";
    } else if (routingConfig.communityMode === "all") {
      statsPolicy = "all";
    } else {
      statsPolicy = "mine";
    }
    try {
      const { data, error } = await supabase
        .rpc("fetch_dgn_job_stats_for_policy", {
          p_policy: statsPolicy,
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
    const { session, fetchStats, jobSubscription, routingConfig } = get();
    if (!session || !session.user || jobSubscription) {
      return;
    }

    const { communityMode, monetizeMode, processOwnJobs, trustedIds } =
      routingConfig;
    const allowedIds = trustedIds.join(",");

    // For trusted modes, don't subscribe if there are no IDs yet.
    if (
      (communityMode === "trusted_users" ||
        communityMode === "trusted_projects") &&
      trustedIds.length === 0
    ) {
      set({ stats: { pending: 0, processing: 0, completed: 0, failed: 0 } });
      get().unsubscribeFromJobChanges();
      return;
    }

    const instanceId = Math.random().toString(36).substring(2, 9);
    let channelName: string;
    let postgresChangesOptions: JobRealtimeOptions;

    if (monetizeMode) {
      channelName = `dgn-jobs-monetize-changes:${instanceId}`;
      postgresChangesOptions = {
        event: "*",
        schema: "public",
        table: "dgn_jobs",
        filter: `monetize_job=eq.true`,
      };
    } else if (communityMode === "trusted_projects") {
      channelName = `dgn-jobs-project-changes:${trustedIds.sort().join(",")}:${instanceId}`;
      postgresChangesOptions = {
        event: "*",
        schema: "public",
        table: "dgn_jobs",
        filter: `project_id=in.(${allowedIds})`,
      };
    } else if (communityMode === "trusted_users") {
      channelName = `dgn-jobs-users-changes:${trustedIds.sort().join(",")}:${instanceId}`;
      postgresChangesOptions = {
        event: "*",
        schema: "public",
        table: "dgn_jobs",
        filter: `user_id=in.(${allowedIds})`,
      };
    } else if (communityMode === "all") {
      channelName = `dgn-jobs-all-changes:${instanceId}`;
      postgresChangesOptions = {
        event: "*",
        schema: "public",
        table: "dgn_jobs",
      };
    } else {
      // communityMode === "none" — subscribe only to own jobs if processOwnJobs is set
      if (!processOwnJobs) return;
      channelName = `dgn-jobs-user-changes:${session.user.id}:${instanceId}`;
      postgresChangesOptions = {
        event: "*",
        schema: "public",
        table: "dgn_jobs",
        filter: `user_id=eq.${session.user.id}`,
      };
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
          console.log(`store.ts: Successfully subscribed to ${channelName}`);
        }

        // Handle channel errors (connection lost, timeout, etc.)
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          console.warn(
            `store.ts: Channel ${status} on ${channelName}, attempting reconnection...`,
          );

          // Unsubscribe and resubscribe after a delay
          setTimeout(async () => {
            const { session: currentSession } = get();
            if (currentSession) {
              console.log(
                "store.ts: Resubscribing to job changes after channel error...",
              );
              await get().unsubscribeFromJobChanges();
              get().subscribeToJobChanges();
            }
          }, 3000); // Wait 3 seconds before reconnecting
        }

        if (err) {
          console.error(`store.ts: Subscription error on ${channelName}:`, err);
          // If subscription fails due to auth issues, attempt to recover
          if (
            err.message.includes("JWT") ||
            err.message.includes("auth") ||
            err.message.includes("token")
          ) {
            console.warn(
              "Subscription failed due to authentication issues, attempting recovery...",
            );
            // Force a session refresh
            window.electronAPI
              .getSession()
              .then(async (currentSession: Session | null) => {
                if (currentSession) {
                  console.log("Recovered session, resubscribing...");
                  await get().setSession(currentSession);
                } else {
                  console.error(
                    "No valid session available, unsubscribing from job changes",
                  );
                  get().unsubscribeFromJobChanges();
                }
              })
              .catch((error) => {
                console.error("Failed to get current session:", error);
                get().unsubscribeFromJobChanges();
              });
          }
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
      if (settings?.routingConfig) {
        set({
          routingConfig: {
            ...DEFAULT_ROUTING_CONFIG,
            ...settings.routingConfig,
          },
        });
      }
    } catch (error) {
      console.error("Error loading persistent settings:", error);
    }
  },
  savePersistentSettings: async () => {
    try {
      const { routingConfig } = get();
      await window.electronAPI.saveSettings({ routingConfig });
    } catch (error) {
      console.error("Error saving persistent settings:", error);
    }
  },
}));

function initializeIpcListeners() {
  const {
    setStatus,
    addLog,
    setSession,
    setIsLoading,
    setDockerPullProgress,
    setDockerContainers,
    setJobState,
    setProviderId,
    setAutoCompactStatus,
    setWslRecoveryStatus,
    setDiskSpaceError,
    setEngineSwitchNotice,
    setImageEvictedNotification,
  } = useClientStore.getState();

  // Store cleanup functions from listener registrations
  const cleanupFns: (() => void)[] = [];
  const timeoutIds: number[] = [];

  const scheduleNoticeClear = (callback: () => void, delayMs: number) => {
    const timeoutId = window.setTimeout(callback, delayMs);
    timeoutIds.push(timeoutId);
  };

  cleanupFns.push(
    window.electronAPI.onStatusChange((status) => {
      setStatus(status);
      if (status !== "running") {
        setJobState(createIdleJobState());
      }
      if (status === "stopped" || status === "error") {
        setProviderId(null);
      }
      if (status === "stopping") {
        window.electronAPI.setWindowClosable(false);
      } else {
        window.electronAPI.setWindowClosable(true);
      }
    }),
  );

  cleanupFns.push(window.electronAPI.onLog(addLog));

  cleanupFns.push(window.electronAPI.onProviderId(setProviderId));

  cleanupFns.push(window.electronAPI.onDockerProgress(setDockerPullProgress));

  cleanupFns.push(
    window.electronAPI.onDockerContainersUpdate((containers) => {
      setDockerContainers(containers);
    }),
  );

  window.electronAPI
    .getAutoCompactStatus()
    .then((status) => {
      setAutoCompactStatus(status);
    })
    .catch((error) => {
      console.error("Failed to hydrate auto-compact status:", error);
    });

  cleanupFns.push(
    window.electronAPI.onAutoCompactStatus((status) => {
      setAutoCompactStatus(status);
      if (
        (status.phase === "completed" || status.phase === "failed") &&
        !status.compactInProgress
      ) {
        scheduleNoticeClear(() => {
          const current = useClientStore.getState().autoCompactStatus;
          if (
            current &&
            current.phase === status.phase &&
            !current.compactInProgress
          ) {
            setAutoCompactStatus({
              ...current,
              phase: undefined,
              error: undefined,
              recoveredAfterRestart: undefined,
            });
          }
        }, SYSTEM_NOTICE_TTL_MS);
      }
    }),
  );

  cleanupFns.push(
    window.electronAPI.onWslRecoveryStatus((status) => {
      setWslRecoveryStatus(status);
      if (status.phase === "completed" || status.phase === "failed") {
        scheduleNoticeClear(() => {
          const current = useClientStore.getState().wslRecoveryStatus;
          if (current?.phase === status.phase) {
            setWslRecoveryStatus(null);
          }
        }, SYSTEM_NOTICE_TTL_MS);
      }
    }),
  );

  cleanupFns.push(window.electronAPI.onDiskSpaceError(setDiskSpaceError));

  cleanupFns.push(
    window.electronAPI.onEngineSwitch((notice) => {
      setEngineSwitchNotice(notice);
    }),
  );

  cleanupFns.push(
    window.electronAPI.onImageEvicted((payload) => {
      setImageEvictedNotification(payload);
      scheduleNoticeClear(() => {
        const current = useClientStore.getState().imageEvictedNotification;
        if (current === payload) {
          setImageEvictedNotification(null);
        }
      }, IMAGE_NOTICE_TTL_MS);
    }),
  );

  cleanupFns.push(
    window.electronAPI.onJobStatus((payload: unknown) => {
      if (!isJobStatusPayload(payload)) {
        return;
      }

      if (payload.type === "JOB_START") {
        setJobState({
          status: "processing",
          jobId: payload.id ?? null,
          type: payload.workflow_type ?? null,
        });
      } else if (
        payload.type === "JOB_COMPLETE" ||
        payload.type === "JOB_FAILED" ||
        payload.type === "JOB_CLEARED"
      ) {
        setJobState(createIdleJobState());
        // Refresh stats to ensure counts are accurate
        useClientStore.getState().fetchStats();
      } else if (payload.type === "MONETIZE_JOB_COMPLETE") {
        // Refresh wallet balance after a monetize job completes
        useClientStore.getState().fetchMonetizeWallet();
      }
    }),
  );

  cleanupFns.push(
    window.electronAPI.onSession(async (session) => {
      await setSession(session);
      setIsLoading(false);
    }),
  );

  cleanupFns.push(
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
            refreshToken,
          );

        if (error) {
          console.error(
            "Error persisting session in main process:",
            error.message,
          );
          return;
        }
        if (newSession) {
          await setSession(newSession);
        }
      }
    }),
  );

  // Handle force refresh from main process (token was refreshed)
  cleanupFns.push(
    window.electronAPI.onForceRefresh(async () => {
      console.log("store.ts: Force refresh requested by main process");
      const currentSession = await window.electronAPI.getSession();
      if (currentSession) {
        // Update tokens and resubscribe to ensure realtime is fresh
        await setSession(currentSession);
        console.log("store.ts: Session refreshed, realtime reconnected");
      }
    }),
  );

  // Handle force logout from main process (auth permanently failed)
  cleanupFns.push(
    window.electronAPI.onForceLogout(async () => {
      console.warn("store.ts: Force logout requested by main process");
      await setSession(null);
    }),
  );

  // Return cleanup function for all listeners
  return () => {
    cleanupFns.forEach((cleanup) => cleanup());
    timeoutIds.forEach((timeoutId) => window.clearTimeout(timeoutId));
  };
}

// Initialize listeners and store cleanup function
const cleanupListeners = initializeIpcListeners();

// Export cleanup for potential use in tests or hot reload scenarios
export { cleanupListeners };
