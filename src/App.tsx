import { useEffect, useState } from "react";
import { useClientStore } from "./store";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/Tabs";
import { Dashboard } from "@/components/Dashboard";
import { LogViewer } from "@/components/LogViewer";
import { Auth } from "@/components/Auth";
import { Profile } from "@/components/Profile";
import {
  LayoutDashboard,
  Terminal,
  Moon,
  Sun,
  LogOut,
  User,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "@/config";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

function App() {
  const { setStatus, addLog, theme, setTheme, session, setSession } =
    useClientStore();
  const [activeTab, setActiveTab] = useState("dashboard");

  useEffect(() => {
    const root = window.document.documentElement;
    root.classList.remove("light", "dark");
    root.classList.add(theme);
  }, [theme]);

  useEffect(() => {
    console.log("App.tsx: Setting up Electron API listeners.");
    window.electronAPI.onStatusChange((status) => {
      console.log(`App.tsx: Received status change: ${status}`);
      setStatus(status);
    });
    window.electronAPI.onLog((log) => {
      console.log(`App.tsx: Received log: ${JSON.stringify(log)}`);
      addLog(log);
    });

    // Listener for initial session refresh or logout
    window.electronAPI.onSession((session) => {
      console.log(`App.tsx: Received session update: ${session ? 'authenticated' : 'null'}`);
      setSession(session);
    });

    // Listener for the OAuth redirect callback
    window.electronAPI.onAuthCallback((url) => {
      const hash = new URL(url).hash.substring(1);
      const params = new URLSearchParams(hash);
      const accessToken = params.get("access_token");
      const refreshToken = params.get("refresh_token");

      if (accessToken && refreshToken) {
        supabase.auth
          .setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          })
          .then(({ data, error }) => {
            if (error) {
              console.error(
                "Error setting session from callback:",
                error.message
              );
              return;
            }
            setSession(data.session);
            window.electronAPI.updateSessionInMain(data.session);
          });
      }
    });

    // Clean up listeners on component unmount
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

  if (!session) {
    return <Auth />;
  }

  return (
    <div className="min-h-screen bg-white text-gray-900 dark:bg-gray-900 dark:text-white p-4 md:p-8">
      <div className="max-w-7xl mx-auto">
        <header className="flex items-center justify-between mb-6">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
            DGN Client Dashboard
          </h1>
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-600 dark:text-gray-300">
              {session.user.email}
            </span>
            <Button
              variant="outline"
              size="icon"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            >
              <Sun className="h-[1.2rem] w-[1.2rem] rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
              <Moon className="absolute h-[1.2rem] w-[1.2rem] rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
              <span className="sr-only">Toggle theme</span>
            </Button>
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
          <TabsContent value="logs" activeTab={activeTab}>
            <LogViewer />
          </TabsContent>
          <TabsContent value="profile" activeTab={activeTab}>
            <Profile />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

export default App;
