import {
  Suspense,
  lazy,
  useState,
  useEffect,
  useRef,
  memo,
  type ComponentType,
  type ReactNode,
} from "react";
import { useClientStore } from "./store";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/supabase";
import type { DependencyStatus } from "./types";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Auth } from "@/components/Auth";
import { ShutdownOverlay } from "@/components/ShutdownOverlay";
import { DependencySetup } from "@/components/DependencySetup";
import { SystemNotifications } from "@/components/SystemNotifications";
import { Loader } from "@/components/ui/loader";
import {
  LayoutDashboard,
  Terminal,
  LogOut,
  Container,
  Download,
  ExternalLink,
  History,
  DollarSign,
  HardDrive,
  RefreshCcw,
  ShieldAlert,
} from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "./components/ui/button";

const Dashboard = lazy(() =>
  import("@/components/Dashboard").then((module) => ({
    default: module.Dashboard,
  })),
);
const LogViewer = lazy(() =>
  import("@/components/LogViewer").then((module) => ({
    default: module.LogViewer,
  })),
);
const DockerManagement = lazy(() =>
  import("@/components/DockerManagement").then((module) => ({
    default: module.DockerManagement,
  })),
);
const JobHistory = lazy(() =>
  import("@/components/JobHistory").then((module) => ({
    default: module.JobHistory,
  })),
);
const Monetize = lazy(() =>
  import("@/components/Monetize").then((module) => ({
    default: module.Monetize,
  })),
);

function TabContentLoader() {
  return (
    <div className="flex h-64 items-center justify-center rounded-lg border border-white/10 bg-surface/30">
      <Loader size="lg" variant="primary" />
    </div>
  );
}

type RequiredUpdateInfo = {
  required: boolean;
  severity?: "recommended" | "security";
  reason?: string | null;
  message: string;
  latest_version?: string | null;
  download_url?: string | null;
  release_notes_url?: string | null;
  current_desktop_version?: string | null;
  min_desktop_version?: string | null;
  min_client_version?: string | null;
  min_protocol_version?: number | null;
};

type UpdateProgressInfo = {
  percent: number;
};

type WslDistroMissingNotice = {
  distroName?: string | null;
  confirmed?: boolean;
  failures?: number;
};

function RequiredUpdateScreen({
  update,
  progress,
  downloaded,
}: {
  update: RequiredUpdateInfo;
  progress: UpdateProgressInfo | null;
  downloaded: boolean;
}) {
  const progressPercent = Math.max(
    0,
    Math.min(100, Math.round(progress?.percent ?? 0)),
  );
  const latestVersion = update.latest_version
    ? `Version ${update.latest_version}`
    : "Latest OpenFork";

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-8 text-white">
      <div className="w-full max-w-2xl rounded-lg border border-red-500/25 bg-surface/80 p-6 shadow-2xl shadow-black/30">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-red-500/30 bg-red-500/10 text-red-300">
            <ShieldAlert className="h-6 w-6" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-black uppercase tracking-widest text-red-300">
              Required Security Update
            </p>
            <h1 className="mt-2 text-2xl font-black tracking-normal">
              {latestVersion} is required
            </h1>
            <p className="mt-3 text-sm font-medium leading-6 text-white/70">
              {update.message}
            </p>
          </div>
        </div>

        <div className="mt-5 grid gap-2 rounded-lg border border-white/10 bg-black/20 p-3 text-xs text-white/65 sm:grid-cols-3">
          <div>
            <p className="font-bold uppercase tracking-widest text-white/35">
              Current
            </p>
            <p className="mt-1 text-white">
              {update.current_desktop_version ?? "unknown"}
            </p>
          </div>
          <div>
            <p className="font-bold uppercase tracking-widest text-white/35">
              Required
            </p>
            <p className="mt-1 text-white">
              {update.min_desktop_version ??
                update.min_client_version ??
                update.min_protocol_version ??
                "latest"}
            </p>
          </div>
          <div>
            <p className="font-bold uppercase tracking-widest text-white/35">
              Reason
            </p>
            <p className="mt-1 text-white">{update.reason ?? "policy"}</p>
          </div>
        </div>

        {progress && !downloaded && (
          <div className="mt-5 space-y-2">
            <div className="flex justify-between text-[11px] font-bold uppercase tracking-widest text-white/45">
              <span>Downloading</span>
              <span>{progressPercent}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-red-300 transition-[width] duration-200"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>
        )}

        <div className="mt-6 flex flex-wrap gap-3">
          {downloaded ? (
            <Button
              variant="primary"
              onClick={() => window.electronAPI.installUpdate()}
            >
              <RefreshCcw className="mr-2 h-4 w-4" />
              Restart & Install
            </Button>
          ) : (
            <Button
              variant="primary"
              onClick={() => {
                window.electronAPI.downloadUpdate();
              }}
            >
              <Download className="mr-2 h-4 w-4" />
              Download Update
            </Button>
          )}
          {update.download_url && (
            <Button
              variant="outline"
              onClick={() =>
                window.electronAPI.openExternal(update.download_url!)
              }
            >
              <ExternalLink className="mr-2 h-4 w-4" />
              Open Release
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

// Unified Tab Trigger Style
const TabTrigger = memo(
  ({
    value,
    icon: Icon,
    label,
    children,
  }: {
    value: string;
    icon?: ComponentType<{ className?: string; size?: number | string }>;
    label?: string;
    children?: ReactNode;
  }) => {
    const dockerPullProgress = useClientStore(
      (state) => state.dockerPullProgress,
    );
    const dockerContainers = useClientStore((state) => state.dockerContainers);
    const status = useClientStore((state) => state.status);
    const autoCompactStatus = useClientStore(
      (state) => state.autoCompactStatus,
    );
    const reclaimInProgress = useClientStore(
      (state) =>
        (state.reclaimStatus?.inProgress || state.reclaimStatus?.settling) ??
        false,
    );

    const isDocker = value === "docker";
    const isCompacting =
      isDocker && (!!autoCompactStatus?.compactInProgress || reclaimInProgress);
    const isDownloading =
      isDocker &&
      dockerPullProgress !== null &&
      (status === "starting" || status === "running");
    const isProcessing =
      isDocker && status === "running" && dockerContainers.length > 0;
    const hasActivity = isCompacting || isDownloading || isProcessing;

    return (
      <TabsTrigger
        value={value}
        className="relative h-9 flex-none px-3 sm:px-4 rounded-lg data-[state=active]:bg-primary data-[state=active]:text-white data-[state=active]:shadow-lg transition-[background-color,color,box-shadow,transform] duration-300 text-[10px] font-black uppercase tracking-widest group active:scale-95 hover:bg-white/5 cursor-pointer"
      >
        {isCompacting ? (
          <HardDrive className="mr-2 animate-pulse text-inherit" size={14} />
        ) : isDownloading ? (
          <Download className="mr-2 animate-bounce text-inherit" size={14} />
        ) : isProcessing ? (
          <Container className="mr-2 animate-pulse text-inherit" size={14} />
        ) : Icon ? (
          <Icon
            className="mr-2 group-hover:scale-110 transition-transform"
            size={14}
          />
        ) : null}
        {label || children}
        {hasActivity && (
          <span className="absolute -top-0.5 -right-0.5 flex h-2.5 w-2.5">
            <span
              className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${isCompacting || isDownloading ? "bg-yellow-400" : "bg-primary group-data-[state=active]:bg-white/80"}`}
            />
            <span
              className={`relative inline-flex rounded-full h-2.5 w-2.5 ${isCompacting || isDownloading ? "bg-yellow-500" : "bg-primary border border-white/20 group-data-[state=active]:bg-white group-data-[state=active]:border-primary/20"}`}
            />
          </span>
        )}
      </TabsTrigger>
    );
  },
);

function App() {
  const {
    status,
    session,
    isLoading,
    setSession,
    dependencyStatus,
    setDependencyStatus,
    setAutoCompactStatus,
    setReclaimStatus,
    autoCompactStatus,
    reclaimStatus,
  } = useClientStore();
  const [activeTab, setActiveTab] = useState("dashboard");
  const [, setForceRefreshKey] = useState(0);
  const [checkingDeps, setCheckingDeps] = useState(true);
  const [profile, setProfile] = useState<{
    username?: string;
  } | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [requiredUpdate, setRequiredUpdate] =
    useState<RequiredUpdateInfo | null>(null);
  const [requiredUpdateProgress, setRequiredUpdateProgress] =
    useState<UpdateProgressInfo | null>(null);
  const [requiredUpdateDownloaded, setRequiredUpdateDownloaded] =
    useState(false);

  const handleLogout = () => {
    window.electronAPI.logout();
  };

  useEffect(() => {
    let mounted = true;

    window.electronAPI
      .checkUpdatePolicy()
      .then((update) => {
        if (mounted && update?.required) {
          setRequiredUpdate(update);
        }
      })
      .catch((error) => {
        console.error("Failed to check required update policy:", error);
      });

    const cleanupRequired = window.electronAPI.onRequiredUpdate((update) => {
      if (update?.required) {
        setRequiredUpdate(update);
        setRequiredUpdateDownloaded(false);
        setRequiredUpdateProgress(null);
      }
    });
    const cleanupProgress = window.electronAPI.onUpdateProgress((progress) => {
      setRequiredUpdateProgress(progress);
    });
    const cleanupDownloaded = window.electronAPI.onUpdateDownloaded(() => {
      setRequiredUpdateDownloaded(true);
      setRequiredUpdateProgress(null);
    });

    return () => {
      mounted = false;
      cleanupRequired();
      cleanupProgress();
      cleanupDownloaded();
    };
  }, []);

  // Check dependencies on startup
  useEffect(() => {
    const checkDependencies = async () => {
      try {
        const checkDockerWithCompactionStatus = async () => {
          const [compactStatus, manualReclaimStatus] = await Promise.all([
            window.electronAPI.getAutoCompactStatus().catch((error) => {
              console.error("Failed to check auto-compact status:", error);
              return null;
            }),
            window.electronAPI.getReclaimStatus().catch((error) => {
              console.error("Failed to check reclaim status:", error);
              return null;
            }),
          ]);

          if (
            compactStatus &&
            (compactStatus.compactInProgress ||
              compactStatus.phase !== "completed")
          ) {
            setAutoCompactStatus(compactStatus);
          }

          if (
            manualReclaimStatus &&
            (manualReclaimStatus.inProgress ||
              manualReclaimStatus.settling ||
              manualReclaimStatus.phase === "failed")
          ) {
            setReclaimStatus(manualReclaimStatus);
          }

          if (
            compactStatus?.compactInProgress ||
            manualReclaimStatus?.inProgress ||
            manualReclaimStatus?.settling
          ) {
            return {
              installed: true,
              running: false,
              error: "WSL_COMPACTING",
            };
          }

          return window.electronAPI.checkDocker();
        };

        const [dockerResult, nvidiaResult] = await Promise.all([
          checkDockerWithCompactionStatus(),
          window.electronAPI.checkNvidia(),
        ]);

        const status: DependencyStatus = {
          docker: dockerResult,
          nvidia: nvidiaResult,
          allReady: dockerResult.installed,
        };

        setDependencyStatus(status);
      } catch (error) {
        console.error("Failed to check dependencies:", error);
        // Allow continuing even if check fails
        setDependencyStatus({
          docker: { installed: false, running: false },
          nvidia: { available: false, gpu: null },
          allReady: false,
        });
      } finally {
        setCheckingDeps(false);
      }
    };

    checkDependencies();
  }, [setAutoCompactStatus, setDependencyStatus, setReclaimStatus]);

  // Handle force refresh from main process
  useEffect(() => {
    const handleForceRefresh = () => {
      console.log("Received force refresh request from main process");
      setForceRefreshKey((prev) => prev + 1);
      // Force recheck of session
      window.electronAPI
        .getSession()
        .then((currentSession: Session | null) => {
          if (!currentSession) {
            setSession(null);
          }
        })
        .catch((error) => {
          console.error(
            "Failed to get current session during force refresh:",
            error,
          );
          setSession(null);
        });
    };

    const unsubscribe = window.electronAPI.onForceRefresh(handleForceRefresh);

    return () => {
      // FIX (#15): Clean up the IPC listener to prevent accumulation across re-renders.
      if (typeof unsubscribe === "function") {
        unsubscribe();
      }
    };
  }, [setSession]);

  // Keep a ref so the WSL-missing handler always has the latest status
  // without needing to re-register the listener on every status change.
  const dependencyStatusRef = useRef(dependencyStatus);
  useEffect(() => {
    dependencyStatusRef.current = dependencyStatus;
  }, [dependencyStatus]);

  useEffect(() => {
    const unsubscribe = window.electronAPI.onWslDistroMissing(
      (notice?: WslDistroMissingNotice) => {
        const current = dependencyStatusRef.current;
        const wasReady = current?.allReady === true;
        setDependencyStatus({
          docker: {
            ...(current?.docker ?? {}),
            installed: wasReady,
            running: false,
            error: "WSL_DISTRO_MISSING",
            wslDistro: notice?.distroName ?? current?.docker?.wslDistro,
          },
          nvidia: current?.nvidia ?? { available: false, gpu: null },
          allReady: wasReady,
        });
      },
    );
    return () => {
      if (typeof unsubscribe === "function") unsubscribe();
    };
  }, [setDependencyStatus]);

  useEffect(() => {
    if (
      checkingDeps ||
      !dependencyStatus?.allReady ||
      autoCompactStatus?.compactInProgress ||
      reclaimStatus?.inProgress ||
      reclaimStatus?.settling
    ) {
      return;
    }

    window.electronAPI.startDockerMonitoring();

    return () => {
      window.electronAPI.stopDockerMonitoring();
    };
  }, [
    autoCompactStatus?.compactInProgress,
    checkingDeps,
    dependencyStatus?.allReady,
    reclaimStatus?.inProgress,
    reclaimStatus?.settling,
  ]);

  useEffect(() => {
    const fetchProfile = async () => {
      if (!session?.user?.id) {
        setProfile(null);
        setAvatarUrl(null);
        return;
      }
      try {
        const { data, error } = await supabase
          .from("profiles")
          .select("username")
          .eq("id", session.user.id)
          .single();
        if (error) {
          console.error("Failed to fetch profile:", error);
          setProfile(null);
        } else {
          setProfile(data);
        }

        const { data: avatarAsset, error: avatarError } = await supabase
          .from("assets")
          .select("storage_path, bucket")
          .eq("owner_id", session.user.id)
          .eq("asset_type", "user_avatar")
          .single();

        if (!avatarError && avatarAsset) {
          const { data: signedData } = await supabase.storage
            .from(avatarAsset.bucket)
            .createSignedUrl(avatarAsset.storage_path, 3600);
          setAvatarUrl(signedData?.signedUrl ?? null);
        } else {
          setAvatarUrl(null);
        }
      } catch (err) {
        console.error("Error fetching profile:", err);
        setProfile(null);
        setAvatarUrl(null);
      }
    };
    fetchProfile();
  }, [session]);

  if (requiredUpdate?.required) {
    return (
      <RequiredUpdateScreen
        update={requiredUpdate}
        progress={requiredUpdateProgress}
        downloaded={requiredUpdateDownloaded}
      />
    );
  }

  // Show loading while checking dependencies
  if (checkingDeps) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-background">
        <Loader size="xl" variant="primary" />
        <p className="mt-4 text-muted-foreground animate-pulse">
          Checking system requirements…
        </p>
      </div>
    );
  }

  // Show dependency setup only until the local engine is installed.
  if (dependencyStatus && !dependencyStatus.allReady) {
    return (
      <DependencySetup
        onReady={(readyStatus) => setDependencyStatus(readyStatus)}
        initialStatus={dependencyStatus}
      />
    );
  }

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-background">
        <Loader size="xl" variant="primary" />
        <p className="mt-4 text-muted-foreground animate-pulse">
          Loading Openfork Client…
        </p>
      </div>
    );
  }

  if (!session) {
    return <Auth />;
  }

  const avatarInitial =
    (profile?.username ?? session.user.email)?.[0]?.toUpperCase() ?? "?";

  return (
    <>
      {status === "stopping" && <ShutdownOverlay />}
      <div className="min-h-screen relative overflow-hidden antialiased">
        {/* Website Signature Background Effects */}
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(1200px_600px_at_80%_-10%,color-mix(in_oklab,var(--color-primary)_25%,transparent),transparent_60%),radial-gradient(900px_500px_at_10%_20%,color-mix(in_oklab,var(--color-primary)_18%,transparent),transparent_60%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(to_bottom,color-mix(in_oklab,var(--color-background)_96%,var(--color-foreground)_4%),var(--color-background))]" />

        <div className="relative container mx-auto px-3 py-4 sm:px-4 sm:py-6 max-w-7xl">
          <header className="relative z-20 flex flex-wrap items-center justify-between gap-4 mb-6 p-4 rounded-lg border border-white/20 bg-surface/60 backdrop-blur-md shadow-2xl overflow-hidden shadow-black/20">
            <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-secondary/5" />
            <div className="relative z-10 flex min-w-0 flex-1 items-center gap-3 sm:gap-4">
              <img
                src="./logo.svg"
                alt="Openfork logo"
                width={40}
                height={40}
                className="h-10 w-10 shrink-0 bg-transparent brightness-0 invert drop-shadow-2xl"
              />
              <div className="min-w-0">
                <h1 className="truncate text-2xl md:text-3xl font-black text-white leading-none">
                  Openfork Desktop
                </h1>
                <p className="mt-1 line-clamp-2 text-[10px] md:text-xs text-white/70 font-bold uppercase tracking-widest sm:truncate">
                  Open-Source Peer-to-peer Engine for Video Collaboration
                </p>
              </div>
            </div>

            {/* Status dot + avatar profile menu */}
            <div className="relative z-10 flex shrink-0 items-center gap-4">
              <Popover>
                <PopoverTrigger asChild>
                  {avatarUrl ? (
                    <button
                      type="button"
                      aria-label="Open profile menu"
                      className="h-8 w-8 rounded-full border border-white/20 overflow-hidden hover:border-white/40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                    >
                      <img
                        src={avatarUrl}
                        alt="User avatar"
                        width={32}
                        height={32}
                        className="h-full w-full object-cover"
                      />
                    </button>
                  ) : (
                    <Button
                      aria-label="Open profile menu"
                      className="h-8 w-8 rounded-full p-0 text-sm font-bold"
                    >
                      {avatarInitial}
                    </Button>
                  )}
                </PopoverTrigger>
                <PopoverContent
                  align="end"
                  className="w-56 p-2 bg-surface-secondary/95 backdrop-blur-xl border-white/10 shadow-3xl"
                >
                  <div className="px-3 py-2">
                    <p className="text-[10px] uppercase tracking-widest text-white/50 font-bold mb-1">
                      Signed in as
                    </p>
                    {profile?.username ? (
                      <>
                        <p className="text-xs font-semibold text-white truncate">
                          {profile.username}
                        </p>
                        <p className="text-[10px] text-white/50 truncate mt-0.5">
                          {session.user.email}
                        </p>
                      </>
                    ) : (
                      <p className="text-xs font-semibold text-white truncate">
                        {session.user.email}
                      </p>
                    )}
                  </div>
                  <div className="h-px bg-white/5 my-2" />
                  <button
                    type="button"
                    onClick={handleLogout}
                    className="flex items-center gap-2.5 w-full px-3 py-2.5 text-xs font-bold rounded-lg bg-destructive/10 text-destructive border border-destructive/20 hover:bg-destructive hover:text-white transition-[background-color,color,border-color,transform] duration-300 group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/40"
                  >
                    <LogOut
                      size={14}
                      className="group-hover:-translate-x-0.5 transition-transform"
                    />
                    SIGN OUT
                  </button>
                </PopoverContent>
              </Popover>
            </div>
          </header>

          <SystemNotifications />

          <Tabs
            value={activeTab}
            onValueChange={setActiveTab}
            className="relative z-10"
          >
            <TabsList className="max-w-full bg-surface/40 backdrop-blur-xl border border-white/20 p-1 rounded-lg h-11 overflow-x-auto no-scrollbar justify-start shadow-lg">
              <TabTrigger
                value="dashboard"
                icon={LayoutDashboard}
                label="Dashboard"
              />
              <TabTrigger value="docker" icon={Container} label="Docker" />
              <TabTrigger value="monetize" icon={DollarSign} label="Monetize" />
              <TabTrigger value="history" icon={History} label="History" />
              <TabTrigger value="logs" icon={Terminal} label="Logs" />
            </TabsList>

            <div className="mt-6 transition-all duration-500">
              <Suspense fallback={<TabContentLoader />}>
                <TabsContent
                  value="dashboard"
                  className="mt-0 focus-visible:outline-none"
                >
                  <Dashboard />
                </TabsContent>
                <TabsContent
                  value="logs"
                  className="mt-0 focus-visible:outline-none"
                >
                  <LogViewer />
                </TabsContent>
                <TabsContent
                  value="docker"
                  className="mt-0 focus-visible:outline-none"
                >
                  <DockerManagement />
                </TabsContent>
                <TabsContent
                  value="history"
                  className="mt-0 focus-visible:outline-none"
                >
                  <JobHistory compact />
                </TabsContent>
                <TabsContent
                  value="monetize"
                  className="mt-0 focus-visible:outline-none"
                >
                  <Monetize />
                </TabsContent>
              </Suspense>
            </div>
          </Tabs>
        </div>
      </div>
    </>
  );
}

export default App;
