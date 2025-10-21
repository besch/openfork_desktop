"use client";

import * as React from "react";
import { Check, ChevronsUpDown, Loader2, X } from "lucide-react";
import { useDebounce } from "@/hooks/useDebounce";
import { useClientStore } from "@/store";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/badge";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { Project } from "@/types";

interface ProjectSelectorProps {
  selected: Project[];
  onSelectedChange: (selected: Project[]) => void;
  placeholder?: string;
  disabled?: boolean;
}

function getProjectLabel(project: Project) {
  return `${project.creator.username}/${project.title}`;
}

export function ProjectSelector({
  selected,
  onSelectedChange,
  placeholder = "Select projects...",
  disabled = false,
}: ProjectSelectorProps) {
  const [open, setOpen] = React.useState(false);
  const [searchQuery, setSearchQuery] = React.useState("");
  const debouncedSearchQuery = useDebounce(searchQuery, 500);

  const { projects, fetchProjects, isLoading } = useClientStore();

  React.useEffect(() => {
    if (open) {
      fetchProjects(debouncedSearchQuery);
    } else {
      useClientStore.setState({ projects: [] });
    }
  }, [debouncedSearchQuery, fetchProjects, open]);

  const handleToggle = (project: Project) => {
    const isSelected = selected.some((p) => p.id === project.id);
    if (isSelected) {
      onSelectedChange(selected.filter((p) => p.id !== project.id));
    } else {
      onSelectedChange([...selected, project]);
    }
  };

  const handleRemove = (project: Project) => {
    onSelectedChange(selected.filter((p) => p.id !== project.id));
  };

  const selectedIds = new Set(selected.map((p) => p.id));

  const triggerText = React.useMemo(() => {
    if (selected.length === 0) return placeholder;
    if (selected.length === 1) return getProjectLabel(selected[0]);
    return `${selected.length} projects selected`;
  }, [selected, placeholder]);

  return (
    <div className="space-y-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className={cn(
              "w-full justify-between",
              disabled && "opacity-50 cursor-not-allowed"
            )}
            disabled={disabled}
          >
            <span className="truncate">{triggerText}</span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="w-[--radix-popover-trigger-width] p-1"
          align="start"
        >
          <Command shouldFilter={false}>
            <CommandInput
              placeholder="Search for projects..."
              value={searchQuery}
              onValueChange={setSearchQuery}
            />
            <CommandList>
              {isLoading && (
                <div className="p-4 text-sm text-center text-muted-foreground flex items-center justify-center">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Searching...
                </div>
              )}
              {!isLoading && projects.length === 0 && debouncedSearchQuery && (
                <CommandEmpty>
                  No projects found for "{debouncedSearchQuery}".
                </CommandEmpty>
              )}

              <CommandGroup>
                {projects.map((project) => (
                  <CommandItem
                    key={project.id}
                    value={getProjectLabel(project)}
                    onSelect={() => handleToggle(project)}
                    className="cursor-pointer"
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4",
                        selectedIds.has(project.id)
                          ? "opacity-100"
                          : "opacity-0"
                      )}
                    />
                    <span>{getProjectLabel(project)}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {selected.map((project) => (
            <Badge
              key={project.id}
              variant="secondary"
              className="flex items-center gap-2 border-primary/40 px-3 py-1.5"
            >
              <span className="truncate">{getProjectLabel(project)}</span>
              <button
                onClick={() => !disabled && handleRemove(project)}
                className={cn(
                  "rounded-full p-0.5 hover:bg-muted-foreground/20 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 cursor-pointer",
                  disabled && "cursor-not-allowed"
                )}
                aria-label={`Remove ${getProjectLabel(project)}`}
                disabled={disabled}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
