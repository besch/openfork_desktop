import React, { useState, useEffect } from "react";
import {
  Command,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Badge } from "@/components/ui/badge";
import { X } from "lucide-react";
import type { Profile } from "@/types";
import { AnimatePresence, motion } from "framer-motion";

interface UserSelectionProps {
  selectedUsers: Profile[];
  onSelectedUsersChange: (users: Profile[]) => void;
  disabled?: boolean;
}

export const UserSelection: React.FC<UserSelectionProps> = ({
  selectedUsers,
  onSelectedUsersChange,
  disabled,
}) => {
  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState<Profile[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState(searchTerm);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearchTerm(searchTerm);
    }, 300);

    return () => {
      clearTimeout(handler);
    };
  }, [searchTerm]);

  useEffect(() => {
    if (debouncedSearchTerm.length < 2) {
      setSearchResults([]);
      return;
    }

    const search = async () => {
      setIsLoading(true);
      const result = await window.electronAPI.searchUsers(debouncedSearchTerm);
      if (result && result.success) {
        setSearchResults(result.data);
      } else {
        setSearchResults([]);
      }
      setIsLoading(false);
    };

    search();
  }, [debouncedSearchTerm]);

  const handleSelectUser = (user: Profile) => {
    if (!selectedUsers.some((su) => su.id === user.id)) {
      onSelectedUsersChange([...selectedUsers, user]);
    }
    setSearchTerm("");
    setSearchResults([]);
  };

  const handleRemoveUser = (userId: string) => {
    onSelectedUsersChange(selectedUsers.filter((u) => u.id !== userId));
  };

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-muted-foreground">Allowed Users</p>
      <div
        className={`p-2 border rounded-lg ${
          disabled ? "bg-muted/50" : "bg-background/50"
        }`}
      >
        <div className="flex flex-wrap gap-2 mb-2">
          <AnimatePresence>
            {selectedUsers.map((user) => (
              <motion.div
                key={user.id}
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
                  {user.username}
                  {!disabled && (
                    <button
                      onClick={() => handleRemoveUser(user.id)}
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
            placeholder="Search for users to allow..."
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
                {searchResults.map((user) => (
                  <CommandItem
                    key={user.id}
                    onSelect={() => handleSelectUser(user)}
                    className="cursor-pointer"
                  >
                    {user.username}
                  </CommandItem>
                ))}
              </>
            )}
            {searchResults.length === 0 &&
              debouncedSearchTerm.length > 1 &&
              !isLoading && (
                <CommandItem>
                  <span className="p-2 text-sm text-muted-foreground">
                    No users found.
                  </span>
                </CommandItem>
              )}
          </CommandList>
        </Command>
      </div>
    </div>
  );
};
