import { useState, useEffect } from 'react';
import { useClientStore } from './store';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/Tabs';
import { Dashboard } from '@/components/Dashboard';
import { LogViewer } from '@/components/LogViewer';
import { LayoutDashboard, Terminal } from 'lucide-react';

function App() {
  const { setStatus, addLog } = useClientStore();
  const [activeTab, setActiveTab] = useState('dashboard');

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
    <div className="min-h-screen bg-background text-foreground p-4 md:p-8">
      <div className="max-w-7xl mx-auto">
        <header className="flex items-center justify-between mb-6">
          <h1 className="text-3xl font-bold">DGN Client Dashboard</h1>
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
