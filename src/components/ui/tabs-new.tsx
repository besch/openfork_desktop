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
        "inline-flex h-12 items-center justify-center rounded-xl bg-muted/50 backdrop-blur-sm p-1.5 text-muted-foreground border border-border/50 shadow-lg gap-1",
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
        "inline-flex items-center justify-center whitespace-nowrap rounded-lg px-4 py-2.5 text-sm font-medium ring-offset-background transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 hover:bg-background/50",
        isActive
          ? "bg-background text-foreground shadow-md hover:shadow-lg"
          : "text-muted-foreground hover:text-foreground",
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
    <div
      className={cn(
        "mt-6 animate-in fade-in-0 slide-in-from-bottom-4 duration-300",
        className
      )}
    >
      {children}
    </div>
  ) : null;
};

export { Tabs, TabsList, TabsTrigger, TabsContent };
