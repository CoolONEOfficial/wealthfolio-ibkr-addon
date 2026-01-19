import { Card, Page, PageContent, PageHeader } from "@wealthfolio/ui";
import type { Account, AddonContext } from "@wealthfolio/addon-sdk";
import React, { useState, useEffect } from "react";
import { detectCurrenciesFromIBKR } from "../lib/currency-detector";
import { generateAccountNames } from "../lib/account-name-generator";
import { preprocessIBKRData } from "../lib/ibkr-preprocessor";
import { splitFXConversions } from "../lib/fx-transaction-splitter";
import { resolveTickersFromIBKR } from "../lib/ticker-resolution-service";
import { convertToActivityImports } from "../lib/activity-converter";
import { fetchFlexQuery, setHttpClient } from "../lib/flex-query-fetcher";
import { parseFlexQueryCSV } from "../lib/flex-csv-parser";
import { filterDuplicateActivities } from "../lib/activity-deduplicator";
import StepIndicator from "../components/step-indicator";
import { useMultiCsvParser } from "../hooks/use-multi-csv-parser";
import { IBKRSourceSelectionStep, DataSource } from "../components/ibkr-source-selection-step";
import { IBKRCurrencyPreviewStep } from "../components/ibkr-currency-preview-step";
import { IBKRTickerPreviewStep } from "../components/ibkr-ticker-preview-step";
import { IBKRImportResultsStep } from "../components/ibkr-import-results-step";
import { CsvRowData } from "../presets/types";

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
  const [accountPreviews, setAccountPreviews] = useState<any[]>([]);

  // Step 3 state
  const [isResolving, setIsResolving] = useState(false);
  const [resolutionProgress, setResolutionProgress] = useState<{ current: number; total: number } | undefined>();
  const [transactionGroups, setTransactionGroups] = useState<any[]>([]);

  // Step 4 state
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<{ current: number; total: number; message?: string } | undefined>();
  const [importResults, setImportResults] = useState<any[]>([]);

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

        // Save credentials if requested
        if (rememberCredentials && ctx?.api?.secrets) {
          await Promise.all([
            ctx.api.secrets.set(SECRET_FLEX_TOKEN, flexToken),
            ctx.api.secrets.set(SECRET_QUERY_ID, flexQueryId),
          ]);
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
    } catch (error: any) {
      console.error("Error loading data:", error);
      setLoadingMessage(`Error: ${error.message || "Failed to load data"}`);
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
    data.forEach((row: any) => {
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

    try {
      // Refresh accounts to pick up any newly created accounts
      // This is critical for deduplication when doing multiple imports
      let freshAccounts = accounts;
      if (ctx?.api?.accounts) {
        try {
          freshAccounts = await ctx.api.accounts.getAll();
          setAccounts(freshAccounts);
        } catch (e) {
          console.warn("Failed to refresh accounts, using cached list:", e);
        }
      }

      // Update accountPreviews with fresh account data
      // This ensures existingAccount is set correctly for deduplication
      const updatedPreviews = accountPreviews.map(preview => {
        const existingAccount = freshAccounts.find(
          (a) => a.name === preview.name && a.currency === preview.currency
        );
        return { ...preview, existingAccount };
      });
      setAccountPreviews(updatedPreviews);

      const { processedData } = preprocessIBKRData(parsedData);

      // Pass the search function from addon context for ticker resolution
      const searchFn = ctx?.api?.market?.searchTicker;
      const resolvedData = await resolveTickersFromIBKR(
        processedData,
        (current, total) => setResolutionProgress({ current, total }),
        searchFn
      );

      const activities = await convertToActivityImports(resolvedData, updatedPreviews);
      const accountsByCurrency = new Map<string, Account>(
        updatedPreviews
          .filter(p => p.existingAccount)
          .map(p => [p.currency as string, p.existingAccount as Account])
      );
      const withFXSplit = splitFXConversions(activities, accountsByCurrency);

      // === CONSOLIDATED DEDUPLICATION ===
      // Fetch all existing activities from all existing accounts upfront
      // This allows us to deduplicate against both:
      // 1. Duplicates within the batch (e.g., overlapping CSV files)
      // 2. Duplicates against existing DB activities (e.g., reimporting)
      let allExistingActivities: Array<{
        activityDate: string;
        assetId: string;
        activityType: string;
        quantity: number;
        unitPrice: number;
        amount?: number;
        fee: number;
        currency: string;
        comment?: string;
      }> = [];

      if (ctx?.api?.activities) {
        const existingAccounts = updatedPreviews.filter(p => p.existingAccount);
        for (const preview of existingAccounts) {
          try {
            const accountActivities = await ctx.api.activities.getAll(preview.existingAccount!.id);
            const mapped = accountActivities.map((a: any) => ({
              activityDate: a.date,
              assetId: a.assetSymbol,
              activityType: a.activityType,
              quantity: a.quantity,
              unitPrice: a.unitPrice,
              amount: a.amount,
              fee: a.fee,
              currency: a.currency,
              comment: a.comment,
            }));
            allExistingActivities = allExistingActivities.concat(mapped);
          } catch (e) {
            console.warn(`Failed to fetch existing activities for ${preview.currency}:`, e);
          }
        }
      }

      // Single deduplication pass: catches both batch duplicates AND DB duplicates
      const { unique: dedupedActivities, duplicates: allDuplicates } = filterDuplicateActivities(
        withFXSplit,
        allExistingActivities
      );

      if (allDuplicates.length > 0) {
        console.log(`[Dedup] Removed ${allDuplicates.length} duplicate activities`);
        console.log(`[Dedup] By type:`, allDuplicates.reduce((acc, d) => {
          const key = `${d.currency}-${d.activityType}`;
          acc[key] = (acc[key] || 0) + 1;
          return acc;
        }, {} as Record<string, number>));
      }

      // Group by currency (using deduplicated activities)
      const groupedByCurrency = new Map<string, any[]>();
      dedupedActivities.forEach((activity) => {
        const currency = activity.currency || "USD";
        if (!groupedByCurrency.has(currency)) {
          groupedByCurrency.set(currency, []);
        }
        groupedByCurrency.get(currency)?.push(activity);
      });

      // Create transaction groups
      const groups: any[] = updatedPreviews.map((preview) => {
        const transactions = groupedByCurrency.get(preview.currency) || [];
        return {
          currency: preview.currency,
          accountName: preview.name,
          transactions,
          summary: {
            trades: transactions.filter((t: any) => t.activityType?.includes("BUY") || t.activityType?.includes("SELL")).length,
            dividends: transactions.filter((t: any) => t.activityType?.includes("DIVIDEND")).length,
            deposits: transactions.filter((t: any) => t.activityType === "DEPOSIT" || t.activityType === "TRANSFER_IN").length,
            withdrawals: transactions.filter((t: any) => t.activityType === "WITHDRAWAL" || t.activityType === "TRANSFER_OUT").length,
            fees: transactions.filter((t: any) => t.activityType?.includes("FEE")).length,
            other: transactions.filter((t: any) => !t.activityType || t.activityType === "UNKNOWN").length,
          },
        };
      });

      setTransactionGroups(groups);
      setResolutionProgress(undefined);
      setIsResolving(false);
    } catch (error) {
      console.error("Error processing transactions:", error);
      setIsResolving(false);
    }
  };

  // Step 3 → Step 4: Import transactions
  const handleStartImport = async () => {
    if (!ctx?.api) {
      console.error("No ctx.api available - cannot import!");
      return;
    }

    setIsImporting(true);
    setCurrentStep(4);

    const results: any[] = [];
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
          const transactionsByCurrency = new Map<string, any[]>();
          for (const txn of group.transactions) {
            const txnCurrency = txn.currency || group.currency;
            if (!transactionsByCurrency.has(txnCurrency)) {
              transactionsByCurrency.set(txnCurrency, []);
            }
            transactionsByCurrency.get(txnCurrency)!.push(txn);
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
                existingAccount: newAccount,
                shouldCreate: false,
              });
            }

            // Set accountId on each transaction and import directly
            // (deduplication already happened in Step 3)
            const transactionsWithAccountId = transactions.map((txn: any) => ({
              ...txn,
              accountId: targetAccount!.id,
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
        } catch (error: any) {
          let errorMessage = String(error);
          if (error?.message) errorMessage = error.message;

          results.push({
            accountId: accountPreviews.find((p) => p.currency === group.currency)?.existingAccount?.id || "",
            accountName: group.accountName,
            currency: group.currency,
            success: 0,
            failed: group.transactions.length,
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
            groupName={groupName}
            setGroupName={setGroupName}
            existingGroups={existingGroups}
            dataSource={dataSource}
            setDataSource={setDataSource}
            flexToken={flexToken}
            setFlexToken={setFlexToken}
            flexQueryId={flexQueryId}
            setFlexQueryId={setFlexQueryId}
            showToken={showToken}
            setShowToken={setShowToken}
            rememberCredentials={rememberCredentials}
            setRememberCredentials={setRememberCredentials}
            selectedFiles={selectedFiles}
            setSelectedFiles={setSelectedFiles}
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
