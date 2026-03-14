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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

// Docker tab trigger with activity indicator
const DockerTabTrigger = memo(() => {
  const dockerPullProgress = useClientStore((state) => state.dockerPullProgress);
  const status = useClientStore((state) => state.status);
  const stats = useClientStore((state) => state.stats);

  const isDownloading = dockerPullProgress !== null && (status === "starting" || status === "running");
  const isProcessing = status === "running" && stats.processing > 0;
  const hasActivity = isDownloading || isProcessing;

  return (
    <TabsTrigger value="docker" className="relative data-[state=active]:text-white group">
      {isDownloading ? (
        <Download className="mr-2 animate-bounce text-inherit" size={16} />
      ) : isProcessing ? (
        <Container className="mr-2 animate-pulse text-inherit" size={16} />
      ) : (
        <Container className="mr-2" size={16} />
      )}
      Docker
      {hasActivity && (
        <span className="absolute -top-1 -right-1 flex h-3 w-3">
          <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${isDownloading ? 'bg-yellow-400' : 'bg-primary group-data-[state=active]:bg-white/80'}`} />
          <span className={`relative inline-flex rounded-full h-3 w-3 ${isDownloading ? 'bg-yellow-500' : 'bg-primary border border-white/20 group-data-[state=active]:bg-white group-data-[state=active]:border-primary/20'}`} />
        </span>
      )}
    </TabsTrigger>
  );
});


function App() {
  const { status, session, isLoading, setSession, dependencyStatus, setDependencyStatus } = useClientStore();
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
            error
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
        onReady={() => setDependencyStatus({ ...dependencyStatus, allReady: true })}
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
      <div className="min-h-screen bg-background p-4 md:p-8">
        <div className="max-w-7xl mx-auto">
          <header className="flex items-center justify-between mb-8 p-6 rounded-2xl bg-card/50 backdrop-blur-sm border border-white/10 shadow-lg">
            <div className="flex items-center gap-4">
              <img src="./logo.png" alt="logo" className="h-12" />
              <div>
                <h1 className="text-3xl font-bold bg-gradient-to-r from-foreground to-foreground/80 bg-clip-text text-transparent">
                  Openfork Client
                </h1>
                <p className="text-sm text-muted-foreground">
                  {/* FIX (#12): Align tagline with platform description from GEMINI.md */}
                  Collaborative movie creation platform
                </p>
              </div>
            </div>

            {/* Status dot + avatar profile menu */}
            <div className="flex items-center gap-3">
              <div
                className={`h-2 w-2 rounded-full ${
                  status === "running"
                    ? "bg-green-500 animate-pulse"
                    : status === "starting" || status === "stopping"
                    ? "bg-yellow-400 animate-pulse"
                    : "bg-muted-foreground/40"
                }`}
              />
              <Popover>
                <PopoverTrigger asChild>
                  <button className="h-8 w-8 rounded-full bg-white/10 border border-white/20 text-white text-sm font-semibold flex items-center justify-center hover:bg-white/20 transition-colors">
                    {avatarInitial}
                  </button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-52 p-2">
                  <p className="px-2 py-1.5 text-xs text-muted-foreground truncate">
                    {session.user.email}
                  </p>
                  <div className="h-px bg-border my-1" />
                  <button
                    onClick={handleLogout}
                    className="flex items-center gap-2 w-full px-2 py-1.5 text-sm rounded-md bg-destructive text-destructive-foreground border border-[var(--color-destructive-border)] hover:bg-[var(--color-destructive-hover-bg)] hover:text-[var(--color-destructive-hover-fg)] shadow-md active:scale-95 transition-all text-left"
                  >
                    <LogOut size={14} />
                    Log out
                  </button>
                </PopoverContent>
              </Popover>
            </div>
          </header>

          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="mb-6 bg-card/40 backdrop-blur-md border border-white/10 p-1 rounded-xl">
              <TabsTrigger value="dashboard">
                <LayoutDashboard className="mr-2" size={16} />
                Dashboard
              </TabsTrigger>
              <TabsTrigger value="chart">
                <BarChartIcon className="mr-2" size={16} />
                Chart
              </TabsTrigger>
              <DockerTabTrigger />
              <TabsTrigger value="history">
                <History className="mr-2" size={16} />
                History
              </TabsTrigger>
              <TabsTrigger value="monetize">
                <DollarSign className="mr-2" size={16} />
                Monetize
              </TabsTrigger>
              <TabsTrigger value="logs">
                <Terminal className="mr-2" size={16} />
                Logs
              </TabsTrigger>
            </TabsList>

            <TabsContent value="dashboard">
              <Dashboard />
            </TabsContent>
            <TabsContent value="chart">
              <Chart />
            </TabsContent>
            <TabsContent value="logs">
              <LogViewer />
            </TabsContent>
            <TabsContent value="docker">
              <DockerManagement />
            </TabsContent>
            <TabsContent value="history">
              <JobHistory />
            </TabsContent>
            <TabsContent value="monetize">
              <Monetize />
            </TabsContent>
          </Tabs>
        </div>
      </div>
      <UpdateNotification />
    </>
  );
}

export default App;
