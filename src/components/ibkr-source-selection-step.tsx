import React from "react";
import { Input, Label, Button, Switch } from "@wealthfolio/ui";
import { Upload, Cloud, Eye, EyeOff, Loader2 } from "lucide-react";
import { MultiFileDropzone } from "./multi-file-dropzone";
import { AccountGroupSuggestions } from "./account-group-suggestions";

export type DataSource = "flexquery" | "manual";

interface IBKRSourceSelectionStepProps {
  // Account group
  groupName: string;
  setGroupName: (name: string) => void;
  existingGroups: string[];

  // Data source
  dataSource: DataSource;
  setDataSource: (source: DataSource) => void;

  // Flex Query credentials
  flexToken: string;
  setFlexToken: (token: string) => void;
  flexQueryId: string;
  setFlexQueryId: (id: string) => void;
  showToken: boolean;
  setShowToken: (show: boolean) => void;
  rememberCredentials: boolean;
  setRememberCredentials: (remember: boolean) => void;

  // Manual CSV
  selectedFiles: File[];
  setSelectedFiles: (files: File[]) => void;

  // Actions
  isLoading: boolean;
  onNext: () => void;
}

export const IBKRSourceSelectionStep: React.FC<IBKRSourceSelectionStepProps> = ({
  groupName,
  setGroupName,
  existingGroups,
  dataSource,
  setDataSource,
  flexToken,
  setFlexToken,
  flexQueryId,
  setFlexQueryId,
  showToken,
  setShowToken,
  rememberCredentials,
  setRememberCredentials,
  selectedFiles,
  setSelectedFiles,
  isLoading,
  onNext,
}) => {
  const hasGroupName = groupName.trim().length > 0;
  const hasFlexCredentials = flexToken.trim().length > 0 && flexQueryId.trim().length > 0;
  const hasFiles = selectedFiles.length > 0;

  const canProceed = () => {
    if (!hasGroupName) return false;

    if (dataSource === "flexquery") {
      return hasFlexCredentials;
    } else {
      return hasFiles;
    }
  };

  // Determine what's missing for the button tooltip
  const getMissingRequirements = (): string[] => {
    const missing: string[] = [];
    if (!hasGroupName) missing.push("Account group name");
    if (dataSource === "flexquery") {
      if (!flexToken.trim()) missing.push("Flex Token");
      if (!flexQueryId.trim()) missing.push("Query ID");
    } else {
      if (!hasFiles) missing.push("CSV files");
    }
    return missing;
  };

  return (
    <div className="space-y-6">
      {/* Account Group Selection */}
      <div className="space-y-3">
        <Label className="text-base font-medium">
          Account Group <span className="text-destructive">*</span>
        </Label>
        <p className="text-sm text-muted-foreground">
          Enter a name for the account group. Accounts will be created as "{groupName || "GroupName"} - USD", "{groupName || "GroupName"} - EUR", etc.
        </p>

        <div className="flex flex-col sm:flex-row gap-2">
          <Input
            placeholder="e.g., IBKR Main, IBKR ISA"
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
            className="flex-1"
            list="existing-groups"
          />
          {existingGroups.length > 0 && (
            <datalist id="existing-groups">
              {existingGroups.map((group) => (
                <option key={group} value={group} />
              ))}
            </datalist>
          )}
        </div>

        <AccountGroupSuggestions
          groups={existingGroups}
          currentValue={groupName}
          onSelect={setGroupName}
        />
      </div>

      {/* Data Source Selection */}
      <div className="space-y-3">
        <Label className="text-base font-medium">Data Source</Label>
        <p className="text-sm text-muted-foreground">
          Choose how to load your IBKR transactions
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* Flex Query Option */}
          <button
            type="button"
            onClick={() => setDataSource("flexquery")}
            className={`p-4 rounded-lg border-2 text-left transition-colors ${
              dataSource === "flexquery"
                ? "border-primary bg-primary/5"
                : "border-border hover:border-primary/50"
            }`}
          >
            <div className="flex items-center gap-3">
              <Cloud className={`h-6 w-6 ${dataSource === "flexquery" ? "text-primary" : "text-muted-foreground"}`} />
              <div>
                <div className="font-medium">Flex Query API</div>
                <div className="text-xs text-muted-foreground">
                  Fetch automatically from IBKR
                </div>
              </div>
            </div>
          </button>

          {/* Manual CSV Option */}
          <button
            type="button"
            onClick={() => setDataSource("manual")}
            className={`p-4 rounded-lg border-2 text-left transition-colors ${
              dataSource === "manual"
                ? "border-primary bg-primary/5"
                : "border-border hover:border-primary/50"
            }`}
          >
            <div className="flex items-center gap-3">
              <Upload className={`h-6 w-6 ${dataSource === "manual" ? "text-primary" : "text-muted-foreground"}`} />
              <div>
                <div className="font-medium">Manual CSV Upload</div>
                <div className="text-xs text-muted-foreground">
                  Upload exported CSV files
                </div>
              </div>
            </div>
          </button>
        </div>
      </div>

      {/* Flex Query Credentials */}
      {dataSource === "flexquery" && (
        <div className="space-y-4 p-4 rounded-lg border bg-muted/30">
          <div className="space-y-2">
            <Label htmlFor="flexToken">Flex Token</Label>
            <div className="relative">
              <Input
                id="flexToken"
                type={showToken ? "text" : "password"}
                value={flexToken}
                onChange={(e) => setFlexToken(e.target.value)}
                placeholder="Enter your Flex Web Service token"
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowToken(!showToken)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="flexQueryId">Query ID</Label>
            <Input
              id="flexQueryId"
              type="text"
              value={flexQueryId}
              onChange={(e) => setFlexQueryId(e.target.value)}
              placeholder="Enter your Flex Query ID (numeric)"
            />
          </div>

          <div className="flex items-center justify-between pt-2">
            <div className="space-y-0.5">
              <Label htmlFor="rememberCreds" className="text-sm">Remember credentials</Label>
              <p className="text-xs text-muted-foreground">
                Store securely in system keyring
              </p>
            </div>
            <Switch
              id="rememberCreds"
              checked={rememberCredentials}
              onCheckedChange={setRememberCredentials}
            />
          </div>

          <p className="text-xs text-muted-foreground">
            Get these from IBKR Client Portal → Reporting → Flex Queries → Flex Web Service Configuration
          </p>
        </div>
      )}

      {/* Manual CSV Upload */}
      {dataSource === "manual" && (
        <div className="space-y-3">
          <MultiFileDropzone
            files={selectedFiles}
            onFilesChange={setSelectedFiles}
            accept=".csv"
          />
          <p className="text-xs text-muted-foreground">
            Export Activity Statements from IBKR Client Portal as CSV files
          </p>
        </div>
      )}

      {/* Next Button */}
      <div className="flex flex-col items-end gap-2 pt-4">
        {!canProceed() && !isLoading && (
          <p className="text-xs text-muted-foreground">
            Required: {getMissingRequirements().join(", ")}
          </p>
        )}
        <Button
          onClick={onNext}
          disabled={!canProceed() || isLoading}
          size="lg"
        >
          {isLoading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Loading...
            </>
          ) : (
            <>
              {dataSource === "flexquery" ? "Fetch Data" : "Parse Files"}
            </>
          )}
        </Button>
      </div>
    </div>
  );
};
