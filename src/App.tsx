import { useState } from "react";
import { useClientStore } from "@/store";
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
      <div className="flex flex-col items-center justify-center h-screen bg-gradient-to-br from-background via-background/95 to-background/90">
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
          <header className="flex items-center justify-between mb-8 p-6 rounded-2xl bg-card/80 backdrop-blur-sm border border-border/50 shadow-lg">
            <div className="flex items-center gap-4">
              <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-primary to-primary/80 flex items-center justify-center shadow-lg">
                <LayoutDashboard className="h-6 w-6 text-primary-foreground" />
              </div>
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
              <Button
                variant="outline"
                size="icon"
                onClick={handleLogout}
                className="hover:bg-destructive/10 hover:border-destructive/30 hover:text-destructive transition-all duration-200"
              >
                <LogOut className="h-[1.2rem] w-[1.2rem]" />
                <span className="sr-only">Logout</span>
              </Button>
            </div>
          </header>

          <Tabs>
            <TabsList className="mb-4 bg-card/80 backdrop-blur-sm">
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
