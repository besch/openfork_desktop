import React from "react";
import {
  Command,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Badge } from "@/components/ui/badge";
import { X } from "lucide-react";
import type { Project } from "@/types";
import { AnimatePresence, motion } from "framer-motion";

interface ProjectSelectionProps {
  selectedProjects: Project[];
  onSelectedProjectsChange: (projects: Project[]) => void;
  disabled?: boolean;
}

export const ProjectSelection: React.FC<ProjectSelectionProps> = ({
  selectedProjects,
  onSelectedProjectsChange,
  disabled,
}) => {
  const [searchTerm, setSearchTerm] = React.useState("");
  const [searchResults, setSearchResults] = React.useState<Project[]>([]);
  const [isLoading, setIsLoading] = React.useState(false);
  const [debouncedSearchTerm, setDebouncedSearchTerm] =
    React.useState(searchTerm);

  React.useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearchTerm(searchTerm);
    }, 300);

    return () => {
      clearTimeout(handler);
    };
  }, [searchTerm]);

  React.useEffect(() => {
    if (debouncedSearchTerm.length < 2) {
      setSearchResults([]);
      return;
    }

    const search = async () => {
      setIsLoading(true);
      const result = await window.electronAPI.searchProjects(
        debouncedSearchTerm
      );
      if (result && result.success) {
        setSearchResults(result.data);
      } else {
        setSearchResults([]);
      }
      setIsLoading(false);
    };

    search();
  }, [debouncedSearchTerm]);

  const handleSelectProject = (project: Project) => {
    if (!selectedProjects.some((sp) => sp.id === project.id)) {
      onSelectedProjectsChange([...selectedProjects, project]);
    }
    setSearchTerm("");
    setSearchResults([]);
  };

  const handleRemoveProject = (projectId: string) => {
    onSelectedProjectsChange(
      selectedProjects.filter((p) => p.id !== projectId)
    );
  };

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-muted-foreground">
        Allowed Projects
      </p>
      <div
        className={`p-2 border rounded-lg ${
          disabled ? "bg-muted/50" : "bg-background/50"
        }`}
      >
        <div className="flex flex-wrap gap-2 mb-2">
          <AnimatePresence>
            {selectedProjects.map((project) => (
              <motion.div
                key={project.id}
                layout
                initial={{ opacity: 0, scale: 0.5 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.5 }}
                transition={{ duration: 0.2 }}
              >
                <Badge
                  variant="secondary"
                  className="flex items-center gap-1.5"
                >
                  {project.title}
                  {!disabled && (
                    <button
                      onClick={() => handleRemoveProject(project.id)}
                      className="rounded-full hover:bg-muted-foreground/20 p-0.5"
                    >
                      <X size={12} />
                    </button>
                  )}
                </Badge>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
        <Command className="bg-transparent">
          <CommandInput
            placeholder="Search for projects to allow..."
            value={searchTerm}
            onValueChange={setSearchTerm}
            disabled={disabled}
            className="bg-transparent focus:bg-background/20"
          />
          <CommandList>
            {isLoading && (
              <CommandItem>
                <span className="p-2 text-sm text-muted-foreground">
                  Searching...
                </span>
              </CommandItem>
            )}
            {searchResults.length > 0 && (
              <>
                {searchResults.map((project) => (
                  <CommandItem
                    key={project.id}
                    onSelect={() => handleSelectProject(project)}
                    className="cursor-pointer"
                  >
                    {project.title}
                  </CommandItem>
                ))}
              </>
            )}
            {searchResults.length === 0 &&
              debouncedSearchTerm.length > 1 &&
              !isLoading && (
                <CommandItem>
                  <span className="p-2 text-sm text-muted-foreground">
                    No projects found.
                  </span>
                </CommandItem>
              )}
          </CommandList>
        </Command>
      </div>
    </div>
  );
};
