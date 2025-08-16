import * as React from "react";
import { cn } from "@/utils";

export interface SwitchProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange'> {
  onCheckedChange?: (checked: boolean) => void;
}

const Switch = React.forwardRef<HTMLInputElement, SwitchProps>(({ className, onCheckedChange, ...props }, ref) => {
  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (onCheckedChange) {
      onCheckedChange(event.target.checked);
    }
  };

  return (
    <input
      type="checkbox"
      className={cn(
        "peer relative h-6 w-11 cursor-pointer appearance-none rounded-full border-transparent bg-gray-600 dark:bg-gray-700 transition-colors duration-200 ease-in-out after:absolute after:top-1/2 after:left-1 after:h-5 after:w-5 after:-translate-y-1/2 after:rounded-full after:bg-white after:shadow-sm after:transition-all after:content-[''] checked:bg-green-500 checked:after:left-5 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-white dark:focus:ring-offset-gray-900 disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      ref={ref}
      onChange={handleChange}
      {...props}
    />
  );
});

Switch.displayName = "Switch";

export { Switch };