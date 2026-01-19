import { Card, Page, PageContent, PageHeader } from "@wealthfolio/ui";
import type { Account, AddonContext, ActivityImport } from "@wealthfolio/addon-sdk";
import React, { useState, useEffect } from "react";
import { detectCurrenciesFromIBKR } from "../lib/currency-detector";
import { generateAccountNames } from "../lib/account-name-generator";
import { fetchFlexQuery, setHttpClient, validateFlexToken, validateQueryId } from "../lib/flex-query-fetcher";
import { parseFlexQueryCSV } from "../lib/flex-csv-parser";
import {
  refreshAndUpdateAccountPreviews,
  processAndResolveData,
  fetchExistingActivitiesForDedup,
  deduplicateActivities,
  groupActivitiesByCurrency,
  createTransactionGroups,
} from "../lib/import-orchestrator";
import StepIndicator from "../components/step-indicator";
import { useMultiCsvParser } from "../hooks/use-multi-csv-parser";
import { IBKRSourceSelectionStep, DataSource } from "../components/ibkr-source-selection-step";
import { IBKRCurrencyPreviewStep } from "../components/ibkr-currency-preview-step";
import { IBKRTickerPreviewStep } from "../components/ibkr-ticker-preview-step";
import { IBKRImportResultsStep } from "../components/ibkr-import-results-step";
import { CsvRowData } from "../presets/types";
import type { AccountPreview, TransactionGroup, ImportResult, ProgressInfo } from "../types";

// Secret keys for stored credentials
const SECRET_FLEX_TOKEN = "flex_token";
const SECRET_QUERY_ID = "flex_query_id";

const STEPS = [
  { id: 1, title: "Source & Group" },
  { id: 2, title: "Currency Accounts" },
  { id: 3, title: "Transaction Preview" },
  { id: 4, title: "Import Results" },
];

interface IBKRMultiImportPageProps {
  ctx?: AddonContext;
}

const IBKRMultiImportPage: React.FC<IBKRMultiImportPageProps> = ({ ctx }) => {
  const [currentStep, setCurrentStep] = useState(1);
  const [accounts, setAccounts] = useState<Account[]>([]);

  // Step 1: Source selection state
  const [groupName, setGroupName] = useState("");
  const [dataSource, setDataSource] = useState<DataSource>("manual");
  const [flexToken, setFlexToken] = useState("");
  const [flexQueryId, setFlexQueryId] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [rememberCredentials, setRememberCredentials] = useState(true);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [isLoadingData, setIsLoadingData] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState("");

  // Parsed data (unified from both sources)
  const [parsedData, setParsedData] = useState<CsvRowData[]>([]);

  // CSV Parser hook (for manual uploads)
  const {
    data: manualParsedData,
    errors: parsingErrors,
    isParsing,
    parseMultipleCsvFiles,
    resetParserStates,
  } = useMultiCsvParser();

  // Step 2 state
  const [accountPreviews, setAccountPreviews] = useState<AccountPreview[]>([]);

  // Step 3 state
  const [isResolving, setIsResolving] = useState(false);
  const [resolutionProgress, setResolutionProgress] = useState<ProgressInfo | undefined>();
  const [transactionGroups, setTransactionGroups] = useState<TransactionGroup[]>([]);

  // Step 4 state
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<ProgressInfo | undefined>();
  const [importResults, setImportResults] = useState<ImportResult[]>([]);

  // Initialize HTTP client
  useEffect(() => {
    if (ctx?.api?.http) {
      setHttpClient(ctx.api.http);
    }
  }, [ctx]);

  // Load accounts and saved credentials
  useEffect(() => {
    const loadData = async () => {
      if (!ctx?.api) return;

      // Load accounts
      if (ctx.api.accounts) {
        try {
          const allAccounts = await ctx.api.accounts.getAll();
          setAccounts(allAccounts);
        } catch (e) {
          console.error("Failed to load accounts:", e);
        }
      }

      // Load saved credentials
      if (ctx.api.secrets) {
        try {
          const [savedToken, savedQueryId] = await Promise.all([
            ctx.api.secrets.get(SECRET_FLEX_TOKEN),
            ctx.api.secrets.get(SECRET_QUERY_ID),
          ]);
          if (savedToken) setFlexToken(savedToken);
          if (savedQueryId) setFlexQueryId(savedQueryId);
        } catch (e) {
          console.error("Failed to load saved credentials:", e);
        }
      }
    };

    loadData();
  }, [ctx]);

  // Get unique groups from accounts
  const existingGroups = [...new Set(accounts.map((a) => a.group).filter(Boolean))] as string[];

  // Refresh accounts list from API
  const refreshAccounts = async () => {
    if (ctx?.api?.accounts) {
      try {
        const allAccounts = await ctx.api.accounts.getAll();
        setAccounts(allAccounts);
      } catch (e) {
        console.error("Failed to refresh accounts:", e);
      }
    }
  };

  // Reset the entire import process
  const resetImportProcess = async () => {
    // Refresh accounts to pick up any newly created accounts from previous import
    await refreshAccounts();

    setCurrentStep(1);
    setGroupName("");
    setSelectedFiles([]);
    setParsedData([]);
    setAccountPreviews([]);
    setTransactionGroups([]);
    setImportResults([]);
    setLoadingMessage("");
    resetParserStates();
  };

  // Step 1: Load data from selected source
  const handleLoadData = async () => {
    setIsLoadingData(true);

    try {
      if (dataSource === "flexquery") {
        // Fetch from Flex Query API
        setLoadingMessage("Connecting to IBKR...");

        const result = await fetchFlexQuery(
          { token: flexToken, queryId: flexQueryId },
          {
            onProgress: (msg) => setLoadingMessage(msg),
          }
        );

        if (!result.success || !result.csv) {
          throw new Error(result.error || "Failed to fetch data from IBKR");
        }

        // Save credentials if requested (with validation)
        if (rememberCredentials && ctx?.api?.secrets) {
          const tokenValidation = validateFlexToken(flexToken);
          const queryIdValidation = validateQueryId(flexQueryId);

          if (tokenValidation.valid && queryIdValidation.valid) {
            await Promise.all([
              ctx.api.secrets.set(SECRET_FLEX_TOKEN, flexToken.trim()),
              ctx.api.secrets.set(SECRET_QUERY_ID, flexQueryId.trim()),
            ]);
          } else {
            // Log validation failures but don't block the import
            console.warn("Credential validation failed, not saving:", {
              tokenError: tokenValidation.error,
              queryIdError: queryIdValidation.error,
            });
          }
        }

        // Parse the fetched CSV
        setLoadingMessage("Parsing transactions...");
        const parsed = parseFlexQueryCSV(result.csv);

        if (parsed.errors.length > 0) {
          console.warn("Parse warnings:", parsed.errors);
        }

        setParsedData(parsed.rows);
        setLoadingMessage("");
        processDataToStep2(parsed.rows);

      } else {
        // Parse manual CSV files
        setLoadingMessage("Parsing CSV files...");
        await parseMultipleCsvFiles(selectedFiles);
        // The useEffect below will handle advancing to step 2
      }
    } catch (error) {
      console.error("Error loading data:", error);
      const errorMessage = error instanceof Error ? error.message : "Failed to load data";
      setLoadingMessage(`Error: ${errorMessage}`);
      setIsLoadingData(false);
    }
  };

  // Process manual CSV data when it's ready
  useEffect(() => {
    if (manualParsedData && manualParsedData.length > 0 && currentStep === 1 && !isParsing && dataSource === "manual") {
      setParsedData(manualParsedData);
      processDataToStep2(manualParsedData);
    }
  }, [manualParsedData, isParsing, currentStep, dataSource]);

  // Process parsed data and advance to step 2
  const processDataToStep2 = (data: CsvRowData[]) => {
    const currencies = detectCurrenciesFromIBKR(data);
    const accountNames = generateAccountNames(groupName, currencies);

    const transactionCounts = new Map<string, number>();
    data.forEach((row) => {
      const currency = row.CurrencyPrimary;
      if (currency) {
        transactionCounts.set(currency, (transactionCounts.get(currency) || 0) + 1);
      }
    });

    const previews = accountNames.map((acc) => {
      const existingAccount = accounts.find(
        (a) => a.name === acc.name && a.currency === acc.currency
      );
      return {
        ...acc,
        transactionCount: transactionCounts.get(acc.currency) || 0,
        existingAccount,
      };
    });

    setAccountPreviews(previews);
    setIsLoadingData(false);
    setLoadingMessage("");
    setCurrentStep(2);
  };

  // Step 2: Update account preview
  const handleAccountPreviewChange = (index: number, name: string) => {
    const newPreviews = [...accountPreviews];
    newPreviews[index].name = name;
    setAccountPreviews(newPreviews);
  };

  // Step 2 → Step 3: Process and resolve tickers
  const handleProceedToStep3 = async () => {
    setIsResolving(true);
    setCurrentStep(3);

    const errors: string[] = [];
    let updatedPreviews = accountPreviews;
    let activitiesWithFX: ActivityImport[] = [];

    // 1. Refresh accounts and update previews
    try {
      const result = await refreshAndUpdateAccountPreviews(
        ctx?.api?.accounts,
        accountPreviews,
        accounts
      );
      setAccounts(result.freshAccounts);
      updatedPreviews = result.updatedPreviews;
      setAccountPreviews(updatedPreviews);
    } catch (error) {
      const msg = `Failed to refresh accounts: ${error instanceof Error ? error.message : String(error)}`;
      console.error(msg);
      errors.push(msg);
      // Continue with existing accounts - non-fatal
    }

    // 2. Process data, resolve tickers, convert to activities
    try {
      activitiesWithFX = await processAndResolveData(
        parsedData,
        updatedPreviews,
        ctx?.api?.market?.searchTicker,
        (current, total) => setResolutionProgress({ current, total })
      );
    } catch (error) {
      const msg = `Failed to process transactions: ${error instanceof Error ? error.message : String(error)}`;
      console.error(msg);
      errors.push(msg);
      // This is fatal - cannot continue without activities
      setResolutionProgress(undefined);
      setIsResolving(false);
      return;
    }

    // 3. Fetch existing activities for deduplication
    let existingActivities: import("../types").ActivityFingerprint[] = [];
    try {
      existingActivities = await fetchExistingActivitiesForDedup(
        ctx?.api?.activities,
        updatedPreviews
      );
    } catch (error) {
      const msg = `Failed to fetch existing activities for deduplication: ${error instanceof Error ? error.message : String(error)}`;
      console.warn(msg);
      errors.push(msg);
      // Continue without deduplication - non-fatal but may create duplicates
    }

    // 4. Deduplicate activities
    let dedupedActivities = activitiesWithFX;
    try {
      dedupedActivities = deduplicateActivities(activitiesWithFX, existingActivities);
    } catch (error) {
      const msg = `Deduplication failed, proceeding without: ${error instanceof Error ? error.message : String(error)}`;
      console.warn(msg);
      errors.push(msg);
      // Continue with original activities - non-fatal but may create duplicates
    }

    // 5. Group by currency and create transaction groups
    try {
      const groupedByCurrency = groupActivitiesByCurrency(dedupedActivities);
      const groups = createTransactionGroups(updatedPreviews, groupedByCurrency);
      setTransactionGroups(groups);
    } catch (error) {
      const msg = `Failed to group transactions: ${error instanceof Error ? error.message : String(error)}`;
      console.error(msg);
      errors.push(msg);
    }

    // Log any accumulated warnings
    if (errors.length > 0) {
      console.warn(`Import preparation completed with ${errors.length} warning(s):`, errors);
    }

    setResolutionProgress(undefined);
    setIsResolving(false);
  };

  // Step 3 → Step 4: Import transactions
  const handleStartImport = async () => {
    if (!ctx?.api) {
      console.error("No ctx.api available - cannot import!");
      return;
    }

    setIsImporting(true);
    setCurrentStep(4);

    const results: ImportResult[] = [];
    let currentProgress = 0;
    const totalSteps = accountPreviews.length + transactionGroups.length;

    try {
      // Create accounts
      for (const preview of accountPreviews) {
        if (!preview.existingAccount) {
          setImportProgress({
            current: ++currentProgress,
            total: totalSteps,
            message: `Creating account: ${preview.name}`,
          });

          try {
            const newAccount = await ctx.api.accounts.create({
              name: preview.name,
              currency: preview.currency,
              group: preview.group,
              accountType: "SECURITIES",
              isDefault: false,
              isActive: true,
            });
            preview.existingAccount = newAccount;
          } catch (error) {
            console.error(`Failed to create account ${preview.name}:`, error);
          }
        } else {
          currentProgress++;
        }
      }

      // Import transactions
      for (const group of transactionGroups) {
        setImportProgress({
          current: ++currentProgress,
          total: totalSteps,
          message: `Importing ${group.transactions.length} transactions to ${group.accountName}`,
        });

        try {
          // Group transactions by their actual currency
          const transactionsByCurrency = new Map<string, ActivityImport[]>();
          for (const txn of group.transactions) {
            const txnCurrency = txn.currency || group.currency;
            let currencyGroup = transactionsByCurrency.get(txnCurrency);
            if (!currencyGroup) {
              currencyGroup = [];
              transactionsByCurrency.set(txnCurrency, currencyGroup);
            }
            currencyGroup.push(txn);
          }

          // Track totals for this group
          let groupTotalImported = 0;

          // Import transactions grouped by their actual currency
          for (const [txnCurrency, transactions] of transactionsByCurrency) {
            let targetAccount = accountPreviews.find((p) => p.currency === txnCurrency)?.existingAccount;

            if (!targetAccount) {
              // Create account for this currency
              const newAccountName = `${groupName} - ${txnCurrency}`;
              const newAccount = await ctx.api.accounts.create({
                name: newAccountName,
                currency: txnCurrency,
                group: groupName,
                accountType: "SECURITIES",
                isDefault: false,
                isActive: true,
              });
              targetAccount = newAccount;
              accountPreviews.push({
                currency: txnCurrency,
                name: newAccountName,
                group: groupName,
                transactionCount: transactions.length,
                existingAccount: newAccount,
              });
            }

            // Set accountId on each transaction and import directly
            // (deduplication already happened in Step 3)
            // targetAccount is guaranteed to exist here (either found or created above)
            const accountId = targetAccount.id;
            const transactionsWithAccountId = transactions.map((txn) => ({
              ...txn,
              accountId,
            }));

            if (transactionsWithAccountId.length > 0) {
              await ctx.api.activities.import(transactionsWithAccountId);
              groupTotalImported += transactionsWithAccountId.length;
            }
          }

          results.push({
            accountId: accountPreviews.find((p) => p.currency === group.currency)?.existingAccount?.id || "",
            accountName: group.accountName,
            currency: group.currency,
            success: groupTotalImported,
            failed: 0,
            skipped: 0, // Duplicates already removed in Step 3
            errors: [],
          });
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);

          results.push({
            accountId: accountPreviews.find((p) => p.currency === group.currency)?.existingAccount?.id || "",
            accountName: group.accountName,
            currency: group.currency,
            success: 0,
            failed: group.transactions.length,
            skipped: 0,
            errors: [errorMessage],
          });
        }
      }

      setImportResults(results);
      setImportProgress(undefined);
      setIsImporting(false);
    } catch (error) {
      console.error("Import failed:", error);
      setImportProgress(undefined);
      setIsImporting(false);
    }
  };

  // Navigation
  const goToPreviousStep = () => {
    if (currentStep > 1) setCurrentStep(currentStep - 1);
  };

  // Render current step
  const renderStep = () => {
    switch (currentStep) {
      case 1:
        return (
          <IBKRSourceSelectionStep
            accountGroup={{
              groupName,
              setGroupName,
              existingGroups,
            }}
            dataSource={dataSource}
            setDataSource={setDataSource}
            flexQuery={{
              token: flexToken,
              setToken: setFlexToken,
              queryId: flexQueryId,
              setQueryId: setFlexQueryId,
              showToken,
              setShowToken,
              rememberCredentials,
              setRememberCredentials,
            }}
            csvFiles={{
              files: selectedFiles,
              setFiles: setSelectedFiles,
            }}
            isLoading={isLoadingData || isParsing}
            onNext={handleLoadData}
          />
        );
      case 2:
        return (
          <IBKRCurrencyPreviewStep
            accountPreviews={accountPreviews}
            onAccountPreviewChange={handleAccountPreviewChange}
            onBack={goToPreviousStep}
            onNext={handleProceedToStep3}
          />
        );
      case 3:
        return (
          <IBKRTickerPreviewStep
            isResolving={isResolving}
            resolutionProgress={resolutionProgress}
            transactionGroups={transactionGroups}
            onBack={goToPreviousStep}
            onNext={handleStartImport}
          />
        );
      case 4:
        return (
          <IBKRImportResultsStep
            isImporting={isImporting}
            importProgress={importProgress}
            results={importResults}
            onReset={resetImportProcess}
          />
        );
      default:
        return null;
    }
  };

  return (
    <Page>
      <PageHeader heading="IBKR Multi-Currency Import" />
      <PageContent withPadding={false}>
        <div className="px-2 pt-2 pb-6 sm:px-4 sm:pt-4 md:px-6 md:pt-6">
          <Card className="w-full">
            <div className="border-b px-3 py-3 sm:px-6 sm:py-4">
              <StepIndicator steps={STEPS} currentStep={currentStep} />
            </div>
            <div className="p-3 sm:p-6">
              {loadingMessage && currentStep === 1 && (
                <div className="mb-4 p-3 rounded-md bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300 text-sm">
                  {loadingMessage}
                </div>
              )}
              {parsingErrors.length > 0 && currentStep === 1 && (
                <div className="mb-4 p-3 rounded-md bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300 text-sm">
                  {parsingErrors.map((err, i) => (
                    <div key={i}>{err.message}</div>
                  ))}
                </div>
              )}
              {renderStep()}
            </div>
          </Card>
        </div>
      </PageContent>
    </Page>
  );
};

export default IBKRMultiImportPage;
