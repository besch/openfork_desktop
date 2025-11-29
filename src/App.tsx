import { useState } from "react";
import { useClientStore } from "./store";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dashboard } from "@/components/Dashboard";
import { LogViewer } from "@/components/LogViewer";
import { Auth } from "@/components/Auth";
import { Profile } from "@/components/Profile";
import { Chart } from "@/components/Chart";
import { ShutdownOverlay } from "@/components/ShutdownOverlay";
import {
  LayoutDashboard,
  Terminal,
  LogOut,
  User,
  Loader2,
  BarChart as BarChartIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";

function App() {
  const { status, session, isLoading } = useClientStore();
  const [activeTab, setActiveTab] = useState("dashboard");

  const handleLogout = () => {
    window.electronAPI.logout();
  };

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
              <TabsTrigger value="logs">
                <Terminal className="mr-2" size={16} />
                Logs
              </TabsTrigger>
              <TabsTrigger value="profile">
                <User className="mr-2" size={16} />
                Profile
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
          </Tabs>
        </div>
      </div>
    </>
  );
}

export default App;
