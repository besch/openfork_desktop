import { useEffect, useState } from "react";
import { useClientStore } from "./store";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/Tabs";
import { Dashboard } from "@/components/Dashboard";
import { LogViewer } from "@/components/LogViewer";
import { Auth } from "@/components/Auth";
import { Profile } from "@/components/Profile";
import { Chart } from "@/components/Chart";
import { ShutdownOverlay } from "@/components/ShutdownOverlay";
import {
  LayoutDashboard,
  Terminal,
  Moon,
  Sun,
  LogOut,
  User,
  Loader2,
  BarChart as BarChartIcon,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "@/config";
import type { JobStats } from "@/types";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: false,
  },
});

function App() {
  const { status, setStatus, addLog, theme, session, setSession, setStats } =
    useClientStore();
  const [activeTab, setActiveTab] = useState("dashboard");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const root = window.document.documentElement;
    root.classList.remove("light", "dark");
    root.classList.add(theme);
  }, [theme]);

  useEffect(() => {
    if (!session) return;

    const fetchStats = async () => {
      try {
        const { data, error } = await supabase.rpc("get_dgn_job_stats");
        if (error) throw error;
        if (data && data.length > 0) {
          setStats(data[0] as JobStats);
        } else {
          setStats({ pending: 0, processing: 0, completed: 0, failed: 0 });
        }
      } catch (error) {
        console.error("Error fetching initial job stats:", error);
      }
    };

    fetchStats();

    const channel = supabase
      .channel("dgn_jobs_changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "dgn_jobs" },
        (payload) => {
          console.log("Change received!", payload);
          fetchStats();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [session, setStats]);

  useEffect(() => {
    console.log("App.tsx: Setting up Electron API listeners.");
    window.electronAPI.onStatusChange((status) => {
      console.log(`App.tsx: Received status change: ${status}`);
      setStatus(status);
      if (status === "stopping") {
        window.electronAPI.setWindowClosable(false);
      } else {
        window.electronAPI.setWindowClosable(true);
      }
    });
    window.electronAPI.onLog((log) => {
      console.log(`App.tsx: Received log: ${JSON.stringify(log)}`);
      addLog(log);
    });

    // Listener for initial session refresh or logout
    window.electronAPI.onSession((session) => {
      console.log(
        `App.tsx: Received session update: ${
          session ? "authenticated" : "null"
        }`
      );
      if (session) {
        supabase.auth.setSession({
          access_token: session.access_token,
          refresh_token: session.refresh_token,
        });
      }
      setSession(session);
      setIsLoading(false);
    });

    // Listener for the OAuth redirect callback
    window.electronAPI.onAuthCallback(async (url) => {
      const hash = new URL(url).hash.substring(1);
      const params = new URLSearchParams(hash);
      const accessToken = params.get("access_token");
      const refreshToken = params.get("refresh_token");

      if (accessToken && refreshToken) {
        // Persist session in main process (electron-store)
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
          setSession(newSession);
          supabase.auth.setSession({
            access_token: newSession.access_token,
            refresh_token: newSession.refresh_token,
          });
        }
      }
    });

    return () => {
      window.electronAPI.removeAllListeners("dgn-client:status");
      window.electronAPI.removeAllListeners("dgn-client:log");
      window.electronAPI.removeAllListeners("auth:session");
      window.electronAPI.removeAllListeners("auth:callback");
    };
  }, [setStatus, addLog, setSession]);

  const handleLogout = () => {
    console.log("App.tsx: Initiating logout.");
    window.electronAPI.logout();
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-gray-50 dark:bg-gray-900">
        <Loader2 className="h-12 w-12 animate-spin text-blue-500" />
      </div>
    );
  }

  if (!session) {
    return <Auth />;
  }

  return (
    <>
      {status === "stopping" && <ShutdownOverlay />}
      <div className="min-h-screen bg-gray-50 text-gray-900 dark:bg-gray-900 dark:text-white p-4 md:p-8">
        <div className="max-w-7xl mx-auto">
          <header className="flex items-center justify-between mb-6">
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
              DGN Client Dashboard
            </h1>
            <div className="flex items-center gap-4">
              <span className="text-sm text-gray-600 dark:text-gray-300">
                {session.user.email}
              </span>
              {/* <Button
              variant="outline"
              size="icon"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            >
              <Sun className="h-[1.2rem] w-[1.2rem] rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
              <Moon className="absolute h-[1.2rem] w-[1.2rem] rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
              <span className="sr-only">Toggle theme</span>
            </Button> */}
              <Button variant="outline" size="icon" onClick={handleLogout}>
                <LogOut className="h-[1.2rem] w-[1.2rem]" />
                <span className="sr-only">Logout</span>
              </Button>
            </div>
          </header>

          <Tabs>
            <TabsList className="mb-4">
              <TabsTrigger
                value="dashboard"
                activeTab={activeTab}
                setActiveTab={setActiveTab}
              >
                <LayoutDashboard className="mr-2" size={16} />
                Dashboard
              </TabsTrigger>
              <TabsTrigger
                value="chart"
                activeTab={activeTab}
                setActiveTab={setActiveTab}
              >
                <BarChartIcon className="mr-2" size={16} />
                Chart
              </TabsTrigger>
              <TabsTrigger
                value="logs"
                activeTab={activeTab}
                setActiveTab={setActiveTab}
              >
                <Terminal className="mr-2" size={16} />
                Logs
              </TabsTrigger>
              <TabsTrigger
                value="profile"
                activeTab={activeTab}
                setActiveTab={setActiveTab}
              >
                <User className="mr-2" size={16} />
                Profile
              </TabsTrigger>
            </TabsList>

            <TabsContent value="dashboard" activeTab={activeTab}>
              <Dashboard />
            </TabsContent>
            <TabsContent value="chart" activeTab={activeTab}>
              <Chart />
            </TabsContent>
            <TabsContent value="logs" activeTab={activeTab}>
              <LogViewer />
            </TabsContent>
            <TabsContent value="profile" activeTab={activeTab}>
              <Profile />
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </>
  );
}

export default App;
