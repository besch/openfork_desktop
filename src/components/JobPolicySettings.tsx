import React, { useState, useEffect, useMemo } from "react";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { motion } from "framer-motion";
import { Badge } from "@/components/ui/badge";
import { X, ArrowLeft } from "lucide-react";

interface Project {
  id: string;
  title: string;
  creator: { username: string };
}

interface Branch {
  id: string;
  name: string;
}

interface SelectedItem {
  id: string;
  name: string;
  type: "project" | "branch";
  projectName?: string;
}

interface JobPolicySettingsProps {
  policy: string;
  allowedIds: string;
  setAllowedIds: (ids: string) => void;
  isDisabled: boolean;
}

function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);
    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);
  return debouncedValue;
}

export const JobPolicySettings: React.FC<JobPolicySettingsProps> = ({
  policy,
  allowedIds,
  setAllowedIds,
  isDisabled,
}) => {
  const [displayItems, setDisplayItems] = useState<SelectedItem[]>([]);
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const showAllowedIds =
    policy === "specific_projects" || policy === "specific_branches";

  // This effect syncs the parent `allowedIds` string to the local `displayItems` state.
  // It runs only when the dialog opens to avoid fetching details for every change.
  useEffect(() => {
    if (isDialogOpen && allowedIds) {
      // A real implementation would fetch details for the IDs to show names.
      // For now, we just create placeholder items.
      const itemsFromIds = allowedIds.split(",").map((id) => ({
        id,
        name: `ID: ${id.substring(0, 8)}...`,
        type: policy === "specific_projects" ? "project" : "branch",
      }));
      setDisplayItems(itemsFromIds);
    } else if (!allowedIds) {
      setDisplayItems([]);
    }
  }, [isDialogOpen, policy]);

  const handleRemoveItem = (idToRemove: string) => {
    const newItems = displayItems.filter((item) => item.id !== idToRemove);
    setDisplayItems(newItems);
    setAllowedIds(newItems.map((item) => item.id).join(","));
  };

  const handleConfirmSelection = (newItems: SelectedItem[]) => {
    setDisplayItems(newItems);
    setAllowedIds(newItems.map((item) => item.id).join(","));
    setIsDialogOpen(false);
  };

  const policyLabel = useMemo(() => {
    if (policy === "specific_projects") return "Allowed Projects";
    if (policy === "specific_branches") return "Allowed Branches";
    return "Allowed IDs";
  }, [policy]);

  return (
    <motion.div
      initial={false}
      animate={{
        opacity: showAllowedIds ? 1 : 0,
        height: showAllowedIds ? "auto" : 0,
        marginTop: showAllowedIds ? "1rem" : "0rem",
      }}
      transition={{ duration: 0.3, ease: "easeInOut" }}
      className="space-y-2 overflow-hidden"
    >
      <Label>{policyLabel}</Label>
      <div className="p-2 border rounded-md min-h-[80px] bg-background/50">
        {displayItems.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {displayItems.map((item) => (
              <Badge
                key={item.id}
                variant="secondary"
                className="flex items-center gap-2 pl-3 pr-1 text-sm"
              >
                <span>
                  {item.type === "project"
                    ? item.name
                    : `${item.projectName} / ${item.name}`}
                </span>
                {!isDisabled && (
                  <button
                    onClick={() => handleRemoveItem(item.id)}
                    className="rounded-full p-0.5 hover:bg-muted-foreground/20 transition-colors"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </Badge>
            ))}
          </div>
        ) : (
          <div className="px-2 py-4 text-center">
            <p className="text-sm text-muted-foreground">
              No specific items selected.
            </p>
            <p className="text-xs text-muted-foreground/80">
              When empty, providers will accept any public jobs.
            </p>
          </div>
        )}
      </div>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogTrigger asChild>
          <Button variant="outline" disabled={isDisabled} className="mt-2">
            Search & Add Items
          </Button>
        </DialogTrigger>
        <SearchDialogContent
          policy={policy}
          existingItems={displayItems}
          onConfirm={handleConfirmSelection}
          onCancel={() => setIsDialogOpen(false)}
        />
      </Dialog>
    </motion.div>
  );
};

// The search logic is moved into its own component inside the Dialog
const SearchDialogContent = ({
  policy,
  existingItems,
  onConfirm,
  onCancel,
}: {
  policy: string;
  existingItems: SelectedItem[];
  onConfirm: (items: SelectedItem[]) => void;
  onCancel: () => void;
}) => {
  const [tempSelection, setTempSelection] = useState<SelectedItem[]>(existingItems);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [activeProject, setActiveProject] = useState<Project | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);

  const debouncedSearchQuery = useDebounce(searchQuery, 300);
  const ORCHESTRATOR_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

  useEffect(() => {
    if (debouncedSearchQuery && !activeProject) {
      const fetchProjects = async () => {
        setIsLoading(true);
        try {
          const response = await fetch(
            `${ORCHESTRATOR_URL}/api/search?q=${encodeURIComponent(
              debouncedSearchQuery
            )}`
          );
          const data = await response.json();
          if (response.ok) {
            setSearchResults(data);
          } else {
            console.error("Search failed:", data.error);
            setSearchResults([]);
          }
        } catch (error) {
          console.error("Failed to search projects", error);
          setSearchResults([]);
        } finally {
          setIsLoading(false);
        }
      };
      fetchProjects();
    } else {
      setSearchResults([]);
    }
  }, [debouncedSearchQuery, activeProject, ORCHESTRATOR_URL]);

  useEffect(() => {
    if (activeProject) {
      const fetchBranches = async () => {
        setIsLoading(true);
        try {
          const response = await fetch(
            `${ORCHESTRATOR_URL}/api/projects/${activeProject.id}/branches`
          );
          const data = await response.json();
          if (response.ok) {
            setBranches(data);
          } else {
            console.error("Failed to fetch branches:", data.error);
            setBranches([]);
          }
        } catch (error) {
          console.error("Failed to fetch branches", error);
          setBranches([]);
        } finally {
          setIsLoading(false);
        }
      };
      fetchBranches();
    }
  }, [activeProject, ORCHESTRATOR_URL]);

  const handleSelectItem = (item: SelectedItem) => {
    if (!tempSelection.some((i) => i.id === item.id)) {
      setTempSelection([...tempSelection, item]);
    }
    resetSearchState();
  };

  const handleRemoveTempItem = (idToRemove: string) => {
    setTempSelection(tempSelection.filter((item) => item.id !== idToRemove));
  };

  const resetSearchState = () => {
    setSearchQuery("");
    setActiveProject(null);
    setBranches([]);
  };

  const placeholder = useMemo(() => {
    if (activeProject) return `Searching branches in ${activeProject.title}`;
    return "Search by user/project or name";
  }, [activeProject]);

  const renderListView = () => {
    if (activeProject && policy === "specific_branches") {
      return (
        <CommandGroup heading={`Branches in ${activeProject.title}`}>
          {branches.map((branch) => (
            <CommandItem
              key={branch.id}
              onSelect={() =>
                handleSelectItem({
                  ...branch,
                  type: "branch",
                  projectName: activeProject.title,
                })
              }
            >
              {branch.name}
            </CommandItem>
          ))}
        </CommandGroup>
      );
    }

    return (
      <CommandGroup heading="Public Projects">
        {searchResults.map((project) => (
          <CommandItem
            key={project.id}
            onSelect={() => {
              if (policy === "specific_projects") {
                handleSelectItem({ ...project, name: `${project.creator.username}/${project.title}`, type: "project" });
              } else {
                setActiveProject(project);
              }
            }}
          >
            {project.creator.username} / {project.title}
          </CommandItem>
        ))}
      </CommandGroup>
    );
  };

  return (
    <DialogContent className="sm:max-w-lg h-[600px] flex flex-col">
      <DialogHeader>
        <div className="flex items-center gap-2">
          {activeProject && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setActiveProject(null)}
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
          )}
          <DialogTitle>Search & Add Items</DialogTitle>
        </div>
      </DialogHeader>

      <Command className="border rounded-lg" shouldFilter={false}>
        <CommandInput
          value={searchQuery}
          onValueChange={setSearchQuery}
          placeholder={placeholder}
          disabled={!!activeProject && policy !== "specific_branches"}
        />
        <CommandList>
          {isLoading ? (
            <div className="p-4 text-sm text-center text-muted-foreground">Loading...</div>
          ) : (
            renderListView()
          )}
          <CommandEmpty>No results found.</CommandEmpty>
        </CommandList>
      </Command>

      <div className="flex-grow mt-4 border rounded-lg p-2 space-y-2 overflow-y-auto">
        <h4 className="text-sm font-medium text-muted-foreground px-1">Items to add</h4>
        <div className="flex flex-wrap gap-2">
        {tempSelection.map((item) => (
          <Badge
            key={item.id}
            variant="secondary"
            className="flex items-center gap-2 pl-3 pr-1 text-sm"
          >
            <span>{item.type === "project" ? item.name : `${item.projectName} / ${item.name}`}</span>
            <button
              onClick={() => handleRemoveTempItem(item.id)}
              className="rounded-full p-0.5 hover:bg-muted-foreground/20 transition-colors"
            >
              <X className="h-3 w-3" />
            </button>
          </Badge>
        ))}
        </div>
        {tempSelection.length === 0 && <p className="text-xs text-muted-foreground text-center py-4">No items selected yet.</p>}
      </div>

      <DialogFooter>
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button onClick={() => onConfirm(tempSelection)}>Confirm Selection</Button>
      </DialogFooter>
    </DialogContent>
  );
};