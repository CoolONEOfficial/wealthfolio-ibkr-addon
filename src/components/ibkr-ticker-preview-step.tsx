import { Button } from "./simple-button";
import { Icons } from "./simple-icons";
import { ProgressIndicator } from "./simple-progress";
import { ImportAlert } from "./import-alert";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "./simple-accordion";
import type { TransactionGroup } from "../types";

interface IBKRTickerPreviewStepProps {
  isResolving: boolean;
  resolutionProgress?: { current: number; total: number };
  transactionGroups: TransactionGroup[];
  failedResolutions?: Array<{ symbol: string; isin: string }>;
  onBack: () => void;
  onNext: () => void;
}

export const IBKRTickerPreviewStep = ({
  isResolving,
  resolutionProgress,
  transactionGroups,
  failedResolutions = [],
  onBack,
  onNext,
}: IBKRTickerPreviewStepProps) => {
  const totalTransactions = transactionGroups.reduce(
    (sum, group) => sum + group.transactions.length,
    0
  );

  const canProceed = !isResolving && totalTransactions > 0;

  // Debug logging
  console.log("IBKRTickerPreviewStep render:", {
    isResolving,
    totalTransactions,
    canProceed,
    groupsCount: transactionGroups.length,
    onNextType: typeof onNext,
  });

  const handleStartImportClick = () => {
    console.log("Start Import button clicked!", { canProceed, isResolving, totalTransactions });
    if (canProceed) {
      onNext();
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div>
        <h2 className="mb-2 text-lg font-semibold">Transaction Preview</h2>
        <p className="text-muted-foreground text-sm">
          Review transactions grouped by currency account. {totalTransactions} transactions ready to
          import.
        </p>
      </div>

      {/* Resolution Progress */}
      {isResolving && resolutionProgress && (
        <div className="rounded-lg border p-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-medium">Resolving tickers...</span>
            <span className="text-muted-foreground text-sm">
              {resolutionProgress.current} / {resolutionProgress.total}
            </span>
          </div>
          <ProgressIndicator
            value={(resolutionProgress.current / resolutionProgress.total) * 100}
            className="h-2"
          />
        </div>
      )}

      {/* Failed Resolutions Warning */}
      {failedResolutions.length > 0 && (
        <ImportAlert variant="warning" title="Ticker Resolution Issues">
          {failedResolutions.length} security symbol{failedResolutions.length > 1 ? "s" : ""}{" "}
          could not be resolved automatically. These transactions will be imported with their ISIN
          identifiers. You can manually update the symbols later.
        </ImportAlert>
      )}

      {/* Transaction Groups Accordion */}
      {!isResolving && transactionGroups.length > 0 && (
        <Accordion type="multiple" defaultValue={transactionGroups.map((_, i) => `group-${i}`)}>
          {transactionGroups.map((group, index) => {
            const totalInGroup = group.transactions.length;
            const summaryText = [
              group.summary.trades > 0 && `${group.summary.trades} trades`,
              group.summary.dividends > 0 && `${group.summary.dividends} dividends`,
              group.summary.deposits > 0 && `${group.summary.deposits} deposits`,
              group.summary.withdrawals > 0 && `${group.summary.withdrawals} withdrawals`,
              group.summary.fees > 0 && `${group.summary.fees} fees`,
              group.summary.other > 0 && `${group.summary.other} other`,
            ]
              .filter(Boolean)
              .join(", ");

            return (
              <AccordionItem key={`group-${index}`} value={`group-${index}`}>
                <AccordionTrigger className="hover:no-underline">
                  <div className="flex flex-1 items-center justify-between pr-4">
                    <div className="flex items-center gap-3">
                      <span className="rounded bg-primary/10 px-2.5 py-1 text-sm font-medium">
                        {group.currency}
                      </span>
                      <span className="text-sm font-medium">{group.accountName}</span>
                    </div>
                    <div className="flex items-center gap-4">
                      <span className="text-muted-foreground text-xs">{summaryText}</span>
                      <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium">
                        {totalInGroup}
                      </span>
                    </div>
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <div className="space-y-2 px-4 pb-4 pt-2">
                    <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
                      {group.summary.trades > 0 && (
                        <div className="rounded-lg border p-3">
                          <p className="text-muted-foreground text-xs">Trades</p>
                          <p className="text-lg font-semibold">{group.summary.trades}</p>
                        </div>
                      )}
                      {group.summary.dividends > 0 && (
                        <div className="rounded-lg border p-3">
                          <p className="text-muted-foreground text-xs">Dividends</p>
                          <p className="text-lg font-semibold">{group.summary.dividends}</p>
                        </div>
                      )}
                      {group.summary.deposits > 0 && (
                        <div className="rounded-lg border p-3">
                          <p className="text-muted-foreground text-xs">Deposits</p>
                          <p className="text-lg font-semibold">{group.summary.deposits}</p>
                        </div>
                      )}
                      {group.summary.withdrawals > 0 && (
                        <div className="rounded-lg border p-3">
                          <p className="text-muted-foreground text-xs">Withdrawals</p>
                          <p className="text-lg font-semibold">{group.summary.withdrawals}</p>
                        </div>
                      )}
                      {group.summary.fees > 0 && (
                        <div className="rounded-lg border p-3">
                          <p className="text-muted-foreground text-xs">Fees</p>
                          <p className="text-lg font-semibold">{group.summary.fees}</p>
                        </div>
                      )}
                      {group.summary.other > 0 && (
                        <div className="rounded-lg border p-3">
                          <p className="text-muted-foreground text-xs">Other</p>
                          <p className="text-lg font-semibold">{group.summary.other}</p>
                        </div>
                      )}
                    </div>

                    {/* Sample transactions (first 5) */}
                    <div className="mt-4">
                      <p className="mb-2 text-xs font-medium">Sample Transactions:</p>
                      <div className="space-y-1">
                        {group.transactions.slice(0, 5).map((txn, txnIndex) => (
                          <div
                            key={txnIndex}
                            className="bg-muted/30 flex items-center justify-between rounded p-2 text-xs"
                          >
                            <div className="flex items-center gap-2">
                              <span className="font-mono">{txn.symbol}</span>
                              <span className="text-muted-foreground">{txn.activityType}</span>
                            </div>
                            <span className="text-muted-foreground">{String(txn.date || "")}</span>
                          </div>
                        ))}
                        {group.transactions.length > 5 && (
                          <p className="text-muted-foreground pt-1 text-xs">
                            ... and {group.transactions.length - 5} more
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
      )}

      {/* Info Box */}
      {!isResolving && (
        <div className="bg-muted/50 rounded-lg border p-4">
          <div className="flex items-start gap-2">
            <Icons.Info className="text-primary mt-0.5 h-4 w-4 flex-shrink-0" />
            <div className="text-sm">
              <p className="font-medium">Ready to import</p>
              <p className="text-muted-foreground mt-1 text-xs">
                Transactions have been grouped by currency and are ready for import. Click "Start
                Import" to begin creating accounts and importing transactions.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex items-center justify-between">
        <Button variant="outline" onClick={onBack} disabled={isResolving}>
          <Icons.ChevronLeft className="mr-1 h-4 w-4" />
          Back
        </Button>
        <Button onClick={handleStartImportClick} disabled={!canProceed}>
          {isResolving ? (
            <>
              <span className="mr-2">Processing...</span>
              <Icons.Spinner className="h-4 w-4 animate-spin" />
            </>
          ) : (
            <>
              Start Import
              <Icons.ChevronRight className="ml-1 h-4 w-4" />
            </>
          )}
        </Button>
      </div>
    </div>
  );
};
