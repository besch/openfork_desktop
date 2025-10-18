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
  LogOut,
  User,
  Loader2,
  BarChart as BarChartIcon,
} from "lucide-react";
import { Button } from "@/components/ui/Button";

function App() {
  const { status, theme, session, isLoading } = useClientStore();
  const [activeTab, setActiveTab] = useState("dashboard");

  useEffect(() => {
    const root = window.document.documentElement;
    root.classList.remove("light", "dark");
    root.classList.add(theme);
  }, [theme]);

  const handleLogout = () => {
    window.electronAPI.logout();
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-background">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
      </div>
    );
  }

  if (!session) {
    return <Auth />;
  }

  return (
    <>
      {status === "stopping" && <ShutdownOverlay />}
      <div className="min-h-screen p-4 md:p-8">
        <div className="max-w-7xl mx-auto">
          <header className="flex items-center justify-between mb-6">
            <h1 className="text-3xl font-bold">
              Openfork Client
            </h1>
            <div className="flex items-center gap-4">
              <span className="text-sm text-muted-foreground">
                {session.user.email}
              </span>
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

