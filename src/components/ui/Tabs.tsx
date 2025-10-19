import * as React from "react";
import { cn } from "@/lib/utils";

interface TabsProps {
  children: React.ReactNode;
}

const Tabs = ({ children }: TabsProps) => {
  return <div className="w-full">{children}</div>;
};

interface TabsListProps {
  children: React.ReactNode;
  className?: string;
}

const TabsList = ({ children, className }: TabsListProps) => {
  return (
    <div
      className={cn(
        "inline-flex h-10 items-center justify-center rounded-md bg-muted p-1 text-muted-foreground",
        className
      )}
    >
      {children}
    </div>
  );
};

interface TabsTriggerProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  value: string;
  activeTab: string;
  setActiveTab: (value: string) => void;
}

const TabsTrigger = ({
  value,
  activeTab,
  setActiveTab,
  children,
  className,
  ...props
}: TabsTriggerProps) => {
  const isActive = activeTab === value;
  return (
    <button
      onClick={() => setActiveTab(value)}
      className={cn(
        "inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
        isActive ? "bg-background text-foreground shadow-sm" : "",
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
};

interface TabsContentProps {
  value: string;
  activeTab: string;
  children: React.ReactNode;
  className?: string;
}

const TabsContent = ({
  value,
  activeTab,
  children,
  className,
}: TabsContentProps) => {
  return activeTab === value ? (
    <div className={cn("mt-4", className)}>{children}</div>
  ) : null;
};

export { Tabs, TabsList, TabsTrigger, TabsContent };
