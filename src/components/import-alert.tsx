import { Icons } from "./simple-icons";
import React from "react";

interface ImportAlertProps {
  variant: "error" | "warning" | "info" | "success";
  title: string;
  children: React.ReactNode;
}

export const ImportAlert: React.FC<ImportAlertProps> = ({ variant, title, children }) => {
  const variantStyles = {
    error: "border-red-500 bg-red-50 dark:bg-red-900/10 text-red-900 dark:text-red-100",
    warning: "border-yellow-500 bg-yellow-50 dark:bg-yellow-900/10 text-yellow-900 dark:text-yellow-100",
    info: "border-blue-500 bg-blue-50 dark:bg-blue-900/10 text-blue-900 dark:text-blue-100",
    success: "border-green-500 bg-green-50 dark:bg-green-900/10 text-green-900 dark:text-green-100",
  };

  const Icon = {
    error: Icons.AlertCircle,
    warning: Icons.AlertTriangle,
    info: Icons.Info,
    success: Icons.CheckCircle,
  }[variant];

  return (
    <div className={`rounded-lg border p-4 ${variantStyles[variant]}`}>
      <div className="flex items-start gap-3">
        <Icon className="h-5 w-5 flex-shrink-0 mt-0.5" />
        <div className="flex-1">
          <p className="font-medium">{title}</p>
          <div className="mt-1 text-sm opacity-90">{children}</div>
        </div>
      </div>
    </div>
  );
};
