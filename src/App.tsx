import { useState, useEffect, memo } from "react";
import { useClientStore } from "./store";
import type { Session } from "@supabase/supabase-js";
import type { DependencyStatus } from "./types";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dashboard } from "@/components/Dashboard";
import { LogViewer } from "@/components/LogViewer";
import { Auth } from "@/components/Auth";
import { Chart } from "@/components/Chart";
import { ShutdownOverlay } from "@/components/ShutdownOverlay";
import { DockerManagement } from "@/components/DockerManagement";
import { DependencySetup } from "@/components/DependencySetup";
import { UpdateNotification } from "@/components/UpdateNotification";
import { JobHistory } from "@/components/JobHistory";
import { Monetize } from "@/components/Monetize";
import {
  LayoutDashboard,
  Terminal,
  LogOut,
  Loader2,
  BarChart as BarChartIcon,
  Container,
  Download,
  History,
  DollarSign,
} from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "./components/ui/button";

// Unified Tab Trigger Style
const TabTrigger = memo(
  ({
    value,
    icon: Icon,
    label,
    children,
  }: {
    value: string;
    icon?: any;
    label?: string;
    children?: React.ReactNode;
  }) => {
    const dockerPullProgress = useClientStore(
      (state) => state.dockerPullProgress,
    );
    const status = useClientStore((state) => state.status);
    const stats = useClientStore((state) => state.stats);

    const isDocker = value === "docker";
    const isDownloading =
      isDocker &&
      dockerPullProgress !== null &&
      (status === "starting" || status === "running");
    const isProcessing =
      isDocker && status === "running" && stats.processing > 0;
    const hasActivity = isDownloading || isProcessing;

    return (
      <TabsTrigger
        value={value}
        className="relative h-9 px-4 rounded-xl data-[state=active]:bg-primary data-[state=active]:text-white data-[state=active]:shadow-lg transition-all duration-300 text-[10px] font-black uppercase tracking-widest group active:scale-95 hover:bg-white/5"
      >
        {isDownloading ? (
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
              className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${isDownloading ? "bg-yellow-400" : "bg-primary group-data-[state=active]:bg-white/80"}`}
            />
            <span
              className={`relative inline-flex rounded-full h-2.5 w-2.5 ${isDownloading ? "bg-yellow-500" : "bg-primary border border-white/20 group-data-[state=active]:bg-white group-data-[state=active]:border-primary/20"}`}
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
  } = useClientStore();
  const [activeTab, setActiveTab] = useState("dashboard");
  const [, setForceRefreshKey] = useState(0);
  const [checkingDeps, setCheckingDeps] = useState(true);

  const handleLogout = () => {
    window.electronAPI.logout();
  };

  // Check dependencies on startup
  useEffect(() => {
    const checkDependencies = async () => {
      try {
        const [dockerResult, nvidiaResult] = await Promise.all([
          window.electronAPI.checkDocker(),
          window.electronAPI.checkNvidia(),
        ]);

        const status: DependencyStatus = {
          docker: dockerResult,
          nvidia: nvidiaResult,
          allReady: dockerResult.installed && dockerResult.running,
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
  }, [setDependencyStatus]);

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

  useEffect(() => {
    if (checkingDeps || !dependencyStatus?.allReady) {
      return;
    }

    window.electronAPI.startDockerMonitoring();

    return () => {
      window.electronAPI.stopDockerMonitoring();
    };
  }, [checkingDeps, dependencyStatus?.allReady]);

  // Show loading while checking dependencies
  if (checkingDeps) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-background">
        <div className="relative">
          <Loader2 className="h-16 w-16 animate-spin text-primary" />
          <div className="absolute inset-0 h-16 w-16 animate-ping bg-primary/20 rounded-full" />
        </div>
        <p className="mt-4 text-muted-foreground animate-pulse">
          Checking system requirements...
        </p>
      </div>
    );
  }

  // Show dependency setup if Docker is not ready
  if (dependencyStatus && !dependencyStatus.allReady) {
    return (
      <DependencySetup
        onReady={() =>
          setDependencyStatus({ ...dependencyStatus, allReady: true })
        }
        initialStatus={dependencyStatus}
      />
    );
  }

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-background">
        <div className="relative">
          <Loader2 className="h-16 w-16 animate-spin text-primary" />
          <div className="absolute inset-0 h-16 w-16 animate-ping bg-primary/20 rounded-full" />
        </div>
        <p className="mt-4 text-muted-foreground animate-pulse">
          Loading Openfork Client...
        </p>
      </div>
    );
  }

  if (!session) {
    return <Auth />;
  }

  // Derive avatar initials from email
  const avatarInitial = session.user.email?.[0]?.toUpperCase() ?? "?";

  return (
    <>
      {status === "stopping" && <ShutdownOverlay />}
      <div className="min-h-screen relative overflow-hidden">
        {/* Website Signature Background Effects */}
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(1200px_600px_at_80%_-10%,color-mix(in_oklab,var(--color-primary)_25%,transparent),transparent_60%),radial-gradient(900px_500px_at_10%_20%,color-mix(in_oklab,var(--color-primary)_18%,transparent),transparent_60%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(to_bottom,color-mix(in_oklab,var(--color-background)_96%,var(--color-foreground)_4%),var(--color-background))]" />

        <div className="relative container mx-auto px-4 py-6 max-w-7xl">
          <header className="relative z-20 flex items-center justify-between mb-6 p-4 rounded-3xl border border-white/20 bg-surface/60 backdrop-blur-md shadow-2xl overflow-hidden shadow-black/20">
            <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-secondary/5" />
            <div className="relative z-10 flex items-center gap-4">
              <img
                src="./logo.png"
                alt="logo"
                className="h-10 drop-shadow-2xl"
              />
              <div>
                <h1 className="text-2xl md:text-3xl font-black tracking-tighter text-white leading-none">
                  Openfork Client
                </h1>
                <p className="text-[10px] md:text-xs text-white/70 mt-1 font-bold uppercase tracking-[0.15em]">
                  Open-Source Engine for AI Video Collaboration
                </p>
              </div>
            </div>

            {/* Status dot + avatar profile menu */}
            <div className="relative z-10 flex items-center gap-4">
              <Popover>
                <PopoverTrigger asChild>
                  <Button>{avatarInitial}</Button>
                </PopoverTrigger>
                <PopoverContent
                  align="end"
                  className="w-56 p-2 bg-surface-secondary/95 backdrop-blur-xl border-white/10 shadow-3xl"
                >
                  <div className="px-3 py-2">
                    <p className="text-[10px] uppercase tracking-widest text-white/50 font-bold mb-1">
                      Signed in as
                    </p>
                    <p className="text-xs font-semibold text-white truncate">
                      {session.user.email}
                    </p>
                  </div>
                  <div className="h-px bg-white/5 my-2" />
                  <button
                    onClick={handleLogout}
                    className="flex items-center gap-2.5 w-full px-3 py-2.5 text-xs font-bold rounded-lg bg-destructive/10 text-destructive border border-destructive/20 hover:bg-destructive hover:text-white transition-all duration-300 group"
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

          <Tabs
            value={activeTab}
            onValueChange={setActiveTab}
            className="relative z-10"
          >
            <TabsList className="mb-6 bg-surface/40 backdrop-blur-xl border border-white/20 p-1 rounded-2xl h-11 overflow-x-auto no-scrollbar justify-start shadow-lg">
              <TabTrigger
                value="dashboard"
                icon={LayoutDashboard}
                label="Dashboard"
              />
              <TabTrigger value="chart" icon={BarChartIcon} label="Chart" />
              <TabTrigger value="docker" icon={Container} label="Docker" />
              <TabTrigger value="history" icon={History} label="History" />
              <TabTrigger value="monetize" icon={DollarSign} label="Monetize" />
              <TabTrigger value="logs" icon={Terminal} label="Logs" />
            </TabsList>

            <div className="mt-8 transition-all duration-500">
              <TabsContent
                value="dashboard"
                className="mt-0 focus-visible:outline-none"
              >
                <Dashboard />
              </TabsContent>
              <TabsContent
                value="chart"
                className="mt-0 focus-visible:outline-none"
              >
                <Chart />
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
                <JobHistory />
              </TabsContent>
              <TabsContent
                value="monetize"
                className="mt-0 focus-visible:outline-none"
              >
                <Monetize />
              </TabsContent>
            </div>
          </Tabs>
        </div>
      </div>
      <UpdateNotification />
    </>
  );
}

export default App;
