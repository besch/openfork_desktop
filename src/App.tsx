import { useState, useEffect } from 'react';
import { useClientStore } from './store';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/Tabs';
import { Dashboard } from '@/components/Dashboard';
import { LogViewer } from '@/components/LogViewer';
import { LayoutDashboard, Terminal, Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/Button';

function App() {
  const { setStatus, addLog, theme, setTheme } = useClientStore();
  const [activeTab, setActiveTab] = useState('dashboard');

  useEffect(() => {
    const root = window.document.documentElement;
    root.classList.remove("light", "dark");
    root.classList.add(theme);
  }, [theme]);

  useEffect(() => {
    // Set up IPC listeners
    window.electronAPI.onStatusChange((status) => {
      setStatus(status);
    });

    window.electronAPI.onLog((log) => {
      addLog(log);
    });

    // Clean up listeners on component unmount
    return () => {
      window.electronAPI.removeAllListeners('dgn-client:status');
      window.electronAPI.removeAllListeners('dgn-client:log');
    };
  }, [setStatus, addLog]);

  return (
    <div className="min-h-screen bg-white text-gray-900 dark:bg-gray-900 dark:text-white p-4 md:p-8">
      <div className="max-w-7xl mx-auto">
        <header className="flex items-center justify-between mb-6">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">DGN Client Dashboard</h1>
          <Button variant="outline" size="icon" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
            <Sun className="h-[1.2rem] w-[1.2rem] rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
            <Moon className="absolute h-[1.2rem] w-[1.2rem] rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
            <span className="sr-only">Toggle theme</span>
          </Button>
        </header>

        <Tabs>
          <TabsList className="mb-4">
            <TabsTrigger value="dashboard" activeTab={activeTab} setActiveTab={setActiveTab}>
              <LayoutDashboard className="mr-2" size={16} />
              Dashboard
            </TabsTrigger>
            <TabsTrigger value="logs" activeTab={activeTab} setActiveTab={setActiveTab}>
              <Terminal className="mr-2" size={16} />
              Logs
            </TabsTrigger>
          </TabsList>

          <TabsContent value="dashboard" activeTab={activeTab}>
            <Dashboard />
          </TabsContent>
          <TabsContent value="logs" activeTab={activeTab}>
            <LogViewer />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

export default App;
