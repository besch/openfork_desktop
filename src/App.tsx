import { useState, useEffect } from "react";
import { useClientStore } from "./store";
import type { Session } from "@supabase/supabase-js";
import type { DependencyStatus } from "./types";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dashboard } from "@/components/Dashboard";
import { LogViewer } from "@/components/LogViewer";
import { Auth } from "@/components/Auth";
import { Profile } from "@/components/Profile";
import { Chart } from "@/components/Chart";
import { ShutdownOverlay } from "@/components/ShutdownOverlay";
import { DockerManagement } from "@/components/DockerManagement";
import { DependencySetup } from "@/components/DependencySetup";
import { UpdateNotification } from "@/components/UpdateNotification";
import {
  LayoutDashboard,
  Terminal,
  LogOut,
  User,
  Loader2,
  BarChart as BarChartIcon,
  Container,
} from "lucide-react";
import { Button } from "@/components/ui/button";

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

    window.electronAPI.onForceRefresh(handleForceRefresh);

    return () => {
      // No cleanup needed for simple force refresh listener
    };
  }, [setSession]);

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
                  Distributed Computing Platform
                </p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="hidden md:flex items-center gap-2 px-4 py-2 rounded-lg bg-muted/50 border border-border/30">
                <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                <span className="text-sm text-muted-foreground">
                  {session.user.email}
                </span>
              </div>
              <Button variant="destructive" size="icon" onClick={handleLogout}>
                <LogOut className="h-[1.2rem] w-[1.2rem]" />
                <span className="sr-only">Logout</span>
              </Button>
            </div>
          </header>

          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="mb-4 bg-card/50 backdrop-blur-sm border-white/10">
              <TabsTrigger value="dashboard">
                <LayoutDashboard className="mr-2" size={16} />
                Dashboard
              </TabsTrigger>
              <TabsTrigger value="chart">
                <BarChartIcon className="mr-2" size={16} />
                Chart
              </TabsTrigger>
              <TabsTrigger value="profile">
                <User className="mr-2" size={16} />
                Profile
              </TabsTrigger>
              <TabsTrigger value="docker">
                <Container className="mr-2" size={16} />
                Docker
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
            <TabsContent value="profile">
              <Profile />
            </TabsContent>
            <TabsContent value="docker">
              <DockerManagement />
            </TabsContent>
          </Tabs>
        </div>
      </div>
      <UpdateNotification />
    </>
  );
}

export default App;

