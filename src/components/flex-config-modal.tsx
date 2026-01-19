import React from "react";
import { Dialog, DialogContent } from "@wealthfolio/ui";
import { FlexConfigForm } from "./flex-config-form";
import type { FlexQueryConfig } from "../lib/flex-config-storage";

interface FlexConfigModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  config?: FlexQueryConfig; // undefined = add mode, defined = edit mode
  existingGroups: string[];
  onSubmit: (data: Omit<FlexQueryConfig, "id" | "lastFetchTime" | "lastFetchStatus" | "lastFetchError">) => Promise<void>;
  isSubmitting?: boolean;
}

export const FlexConfigModal: React.FC<FlexConfigModalProps> = ({
  open,
  onOpenChange,
  config,
  existingGroups,
  onSubmit,
  isSubmitting = false,
}) => {
  const handleSubmit = async (data: {
    name: string;
    queryId: string;
    accountGroup: string;
    autoFetchEnabled: boolean;
  }) => {
    await onSubmit(data);
    onOpenChange(false);
  };

  const handleCancel = () => {
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <FlexConfigForm
          defaultValues={config}
          existingGroups={existingGroups}
          onSubmit={handleSubmit}
          onCancel={handleCancel}
          isSubmitting={isSubmitting}
        />
      </DialogContent>
    </Dialog>
  );
};
