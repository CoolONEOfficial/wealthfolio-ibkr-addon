import React, { useState, useEffect } from "react";
import {
  Page,
  PageHeader,
  PageContent,
  Button,
  Input,
  Separator,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  EmptyPlaceholder,
  Skeleton,
} from "@wealthfolio/ui";
import { Plus, Eye, EyeOff, Loader2 } from "lucide-react";
import type { AddonContext, Account } from "@wealthfolio/addon-sdk";
import { FlexConfigItem } from "../components/flex-config-item";
import { FlexConfigModal } from "../components/flex-config-modal";
import type { FlexQueryConfig } from "../lib/flex-config-storage";
import {
  useFlexConfigs,
  useFlexToken,
  useAddConfig,
  useUpdateConfig,
  useDeleteConfig,
  useSaveToken,
} from "../hooks/use-flex-configs";

interface IBKRFlexSettingsPageProps {
  ctx?: AddonContext;
}

const IBKRFlexSettingsPage: React.FC<IBKRFlexSettingsPageProps> = ({ ctx }) => {
  const secrets = ctx?.api?.secrets;

  // Token state
  const [tokenInput, setTokenInput] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [tokenDirty, setTokenDirty] = useState(false);

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editingConfig, setEditingConfig] = useState<FlexQueryConfig | undefined>();

  // Delete confirmation state
  const [deleteConfig, setDeleteConfig] = useState<FlexQueryConfig | null>(null);

  // Account groups (for dropdown suggestions)
  const [existingGroups, setExistingGroups] = useState<string[]>([]);

  // Queries
  const { data: configs, isLoading: configsLoading } = useFlexConfigs(secrets);
  const { data: savedToken, isLoading: tokenLoading } = useFlexToken(secrets);

  // Mutations
  const addConfigMutation = useAddConfig(secrets);
  const updateConfigMutation = useUpdateConfig(secrets);
  const deleteConfigMutation = useDeleteConfig(secrets);
  const saveTokenMutation = useSaveToken(secrets);

  // Load accounts to get existing groups
  useEffect(() => {
    const loadAccounts = async () => {
      if (!ctx?.api?.accounts) return;
      try {
        const accounts: Account[] = await ctx.api.accounts.getAll();
        const groups = [...new Set(accounts.map((a) => a.group).filter(Boolean))] as string[];
        setExistingGroups(groups.sort());
      } catch (e) {
        console.error("Failed to load accounts:", e);
      }
    };
    loadAccounts();
  }, [ctx]);

  // Sync token input with saved token
  useEffect(() => {
    if (savedToken !== undefined && savedToken !== null && !tokenDirty) {
      setTokenInput(savedToken);
    }
  }, [savedToken, tokenDirty]);

  const handleTokenChange = (value: string) => {
    setTokenInput(value);
    setTokenDirty(true);
  };

  const handleSaveToken = async () => {
    await saveTokenMutation.mutateAsync(tokenInput);
    setTokenDirty(false);
  };

  const handleAddConfig = () => {
    setEditingConfig(undefined);
    setModalOpen(true);
  };

  const handleEditConfig = (config: FlexQueryConfig) => {
    setEditingConfig(config);
    setModalOpen(true);
  };

  const handleDeleteConfig = (config: FlexQueryConfig) => {
    setDeleteConfig(config);
  };

  const confirmDelete = async () => {
    if (deleteConfig) {
      await deleteConfigMutation.mutateAsync(deleteConfig.id);
      setDeleteConfig(null);
    }
  };

  const handleSubmitConfig = async (data: {
    name: string;
    queryId: string;
    accountGroup: string;
    autoFetchEnabled: boolean;
  }) => {
    if (editingConfig) {
      await updateConfigMutation.mutateAsync({
        id: editingConfig.id,
        updates: data,
      });
    } else {
      await addConfigMutation.mutateAsync(data);
    }
  };

  const isSubmitting = addConfigMutation.isPending || updateConfigMutation.isPending;

  return (
    <Page>
      <PageHeader
        heading="IBKR Flex Query Settings"
        actions={
          <Button onClick={handleAddConfig}>
            <Plus className="mr-2 h-4 w-4" />
            Add Query
          </Button>
        }
      />

      <PageContent>
        <div className="space-y-6">
          {/* Token Section */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Flex Token</CardTitle>
              <CardDescription>
                Your IBKR Flex Web Service token. This is shared across all queries.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {tokenLoading ? (
                <Skeleton className="h-10 w-full" />
              ) : (
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Input
                      type={showToken ? "text" : "password"}
                      value={tokenInput}
                      onChange={(e) => handleTokenChange(e.target.value)}
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
                  <Button
                    onClick={handleSaveToken}
                    disabled={!tokenDirty || saveTokenMutation.isPending}
                  >
                    {saveTokenMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      "Save"
                    )}
                  </Button>
                </div>
              )}
              <p className="mt-2 text-xs text-muted-foreground">
                Get this from IBKR Client Portal → Reporting → Flex Queries → Flex Web Service Configuration
              </p>
            </CardContent>
          </Card>

          <Separator />

          {/* Saved Queries Section */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-medium">Saved Queries</h3>
                <p className="text-sm text-muted-foreground">
                  Each query fetches transactions for a specific account group.
                </p>
              </div>
            </div>

            {configsLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-20 w-full" />
                <Skeleton className="h-20 w-full" />
              </div>
            ) : configs && configs.length > 0 ? (
              <div className="divide-y rounded-md border">
                {configs.map((config) => (
                  <FlexConfigItem
                    key={config.id}
                    config={config}
                    onEdit={() => handleEditConfig(config)}
                    onDelete={() => handleDeleteConfig(config)}
                  />
                ))}
              </div>
            ) : (
              <EmptyPlaceholder>
                <EmptyPlaceholder.Icon name="Settings" />
                <EmptyPlaceholder.Title>No queries configured</EmptyPlaceholder.Title>
                <EmptyPlaceholder.Description>
                  Add a Flex Query configuration to automatically fetch IBKR transactions.
                </EmptyPlaceholder.Description>
                <Button onClick={handleAddConfig}>
                  <Plus className="mr-2 h-4 w-4" />
                  Add Query
                </Button>
              </EmptyPlaceholder>
            )}
          </div>
        </div>
      </PageContent>

      {/* Add/Edit Modal */}
      <FlexConfigModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        config={editingConfig}
        existingGroups={existingGroups}
        onSubmit={handleSubmitConfig}
        isSubmitting={isSubmitting}
      />

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteConfig} onOpenChange={() => setDeleteConfig(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Configuration</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{deleteConfig?.name}"? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteConfigMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Page>
  );
};

export default IBKRFlexSettingsPage;
