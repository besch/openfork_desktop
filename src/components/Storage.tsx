import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { RefreshCw, Trash2, Box, Image as ImageIcon } from "lucide-react";
import type { DockerResources } from "@/types";

export function Storage() {
  const [resources, setResources] = useState<DockerResources | null>(null);
  const [selectedContainers, setSelectedContainers] = useState<Set<string>>(new Set());
  const [selectedImages, setSelectedImages] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    window.electronAPI.onResources((data) => {
      setResources(data);
      setIsLoading(false);
    });
    
    fetchResources();
  }, []);

  const fetchResources = () => {
    setIsLoading(true);
    window.electronAPI.listResources();
    
    // Safety timeout
    setTimeout(() => {
      setIsLoading(current => {
          if (current) console.warn("Resource fetch timed out");
          return false;
      });
    }, 5000);
  };

  const toggleContainer = (id: string, checked: boolean) => {
    const newSelected = new Set(selectedContainers);
    if (checked) newSelected.add(id);
    else newSelected.delete(id);
    setSelectedContainers(newSelected);
  };

  const toggleImage = (id: string, checked: boolean) => {
    const newSelected = new Set(selectedImages);
    if (checked) newSelected.add(id);
    else newSelected.delete(id);
    setSelectedImages(newSelected);
  };

  const handleCleanupSelected = () => {
    if (selectedContainers.size === 0 && selectedImages.size === 0) {
      alert("Please select at least one item to clean up.");
      return;
    }

    if (confirm(`Are you sure you want to remove ${selectedContainers.size} containers and ${selectedImages.size} images? This action cannot be undone.`)) {
      window.electronAPI.cleanup(
        false, 
        false, 
        Array.from(selectedContainers), 
        Array.from(selectedImages)
      );
      alert("Cleanup started. Check logs for details.");
      setSelectedContainers(new Set());
      setSelectedImages(new Set());
      setTimeout(fetchResources, 2000);
    }
  };

  const handleBulkCleanup = (type: 'containers' | 'images') => {
      const isContainers = type === 'containers';
      const label = isContainers ? 'ALL OpenFork Containers' : 'ALL OpenFork Images';
      if (confirm(`Are you sure you want to remove ${label}? This will delete ALL resources of this type created by OpenFork and cannot be undone.`)) {
          window.electronAPI.cleanup(
              !isContainers, // removeImages (if type is images, this is TRUE)
              isContainers,  // removeContainers
              [], []
          );
          alert("Cleanup started. Check logs for details.");
          setTimeout(fetchResources, 2000);
      }
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <Card className="bg-card/50 backdrop-blur-sm border-white/10">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Docker Resources</CardTitle>
            <CardDescription>Manage and clean up Docker containers and images.</CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={fetchResources} disabled={isLoading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Bulk Actions */}
          <div className="flex flex-col gap-4 p-4 rounded-lg bg-destructive/10 border border-destructive/20">
             <h3 className="font-semibold text-sm text-destructive uppercase tracking-wider">Destructive Zone</h3>
             <div className="flex flex-col sm:flex-row gap-4">
                <Button variant="destructive" className="flex-1" onClick={() => handleBulkCleanup('containers')}>
                    <Trash2 className="mr-2 h-4 w-4" />
                    Delete All Containers
                </Button>
                <Button variant="destructive" className="flex-1" onClick={() => handleBulkCleanup('images')}>
                    <Trash2 className="mr-2 h-4 w-4" />
                    Delete All Images
                </Button>
             </div>
          </div>

          {/* Individual Lists */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Containers List */}
            <div className="space-y-3">
              <div className="flex items-center gap-2 pb-2 border-b border-white/10">
                <Box className="h-4 w-4 text-blue-400" />
                <h3 className="font-medium">Containers</h3>
                <span className="text-xs text-muted-foreground ml-auto">
                  {resources?.containers.length || 0} found
                </span>
              </div>
              <div className="h-[300px] overflow-y-auto pr-2 space-y-2">
                {!resources ? (
                    <div className="text-sm text-muted-foreground text-center py-8">Loading...</div>
                ) : resources.containers.length === 0 ? (
                    <div className="text-sm text-muted-foreground text-center py-8">No containers found</div>
                ) : (
                    resources.containers.map(container => (
                        <div key={container.id} className={`flex flex-col gap-2 p-3 rounded-md border text-sm transition-colors ${selectedContainers.has(container.id) ? 'bg-primary/10 border-primary/20' : 'bg-background/40 border-white/5'}`}>
                           <div className="flex items-start justify-between gap-2">
                               <div className="flex flex-col gap-0.5 overflow-hidden">
                                   <span className="font-medium truncate" title={container.name}>{container.name}</span>
                                   <span className="text-xs text-muted-foreground truncate" title={container.image}>{container.image}</span>
                               </div>
                               <input 
                                 type="checkbox"
                                 className="mt-1 h-4 w-4 rounded border-gray-300 bg-background text-primary focus:ring-2 focus:ring-primary"
                                 checked={selectedContainers.has(container.id)}
                                 onChange={(e) => toggleContainer(container.id, e.target.checked)}
                               />
                           </div>
                           <div className="flex items-center justify-between text-xs">
                               <span className={`px-1.5 py-0.5 rounded-full ${container.status.startsWith('Up') ? 'bg-green-500/10 text-green-400' : 'bg-yellow-500/10 text-yellow-400'}`}>
                                   {container.status}
                               </span>
                               <span className="font-mono text-muted-foreground/60">{container.id.substring(0, 8)}</span>
                           </div>
                        </div>
                    ))
                )}
              </div>
            </div>

            {/* Images List */}
            <div className="space-y-3">
              <div className="flex items-center gap-2 pb-2 border-b border-white/10">
                <ImageIcon className="h-4 w-4 text-purple-400" />
                <h3 className="font-medium">Images</h3>
                <span className="text-xs text-muted-foreground ml-auto">
                   {resources?.images.length || 0} found
                </span>
              </div>
              <div className="h-[300px] overflow-y-auto pr-2 space-y-2">
                {!resources ? (
                    <div className="text-sm text-muted-foreground text-center py-8">Loading...</div>
                ) : resources.images.length === 0 ? (
                    <div className="text-sm text-muted-foreground text-center py-8">No images found</div>
                ) : (
                    resources.images.map(image => (
                        <div key={image.id} className={`flex flex-col gap-2 p-3 rounded-md border text-sm transition-colors ${selectedImages.has(image.id) ? 'bg-primary/10 border-primary/20' : 'bg-background/40 border-white/5'}`}>
                           <div className="flex items-start justify-between gap-2">
                               <div className="flex flex-col gap-0.5 overflow-hidden">
                                   <span className="font-medium truncate" title={image.tags[0]}>{image.tags[0] || '<none>'}</span>
                                   <span className="text-xs text-muted-foreground">{image.size} MB</span>
                               </div>
                               <input 
                                 type="checkbox"
                                 className="mt-1 h-4 w-4 rounded border-gray-300 bg-background text-primary focus:ring-2 focus:ring-primary"
                                 checked={selectedImages.has(image.id)}
                                 onChange={(e) => toggleImage(image.id, e.target.checked)}
                               />
                           </div>
                           <div className="flex items-center justify-between text-xs text-muted-foreground/60">
                               <span>{new Date(image.created).toLocaleDateString()}</span>
                               <span className="font-mono">{image.id.substring(0, 12)}</span>
                           </div>
                        </div>
                    ))
                )}
              </div>
            </div>
          </div>

          <Button 
            variant="secondary" 
            size="lg"
            className="w-full mt-4"
            onClick={handleCleanupSelected}
            disabled={(selectedContainers.size === 0 && selectedImages.size === 0)}
          >
            <Trash2 className="mr-2 h-4 w-4" />
            Clean Up Selected Resources
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
