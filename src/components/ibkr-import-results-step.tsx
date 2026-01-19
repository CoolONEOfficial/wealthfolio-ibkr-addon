import { Button } from "./simple-button";
import { Icons } from "./simple-icons";
import { ProgressIndicator } from "./simple-progress";
import { ImportAlert } from "./import-alert";

interface ImportResult {
  accountId: string;
  accountName: string;
  currency: string;
  success: number;
  failed: number;
  errors: string[];
}

interface IBKRImportResultsStepProps {
  isImporting: boolean;
  importProgress?: { current: number; total: number; message?: string };
  results: ImportResult[];
  onReset: () => void;
}

export const IBKRImportResultsStep = ({
  isImporting,
  importProgress,
  results,
  onReset,
}: IBKRImportResultsStepProps) => {
  const totalSuccess = results.reduce((sum, r) => sum + r.success, 0);
  const totalFailed = results.reduce((sum, r) => sum + r.failed, 0);
  const hasErrors = results.some((r) => r.errors.length > 0);
  const allErrors = results.flatMap((r) => r.errors);

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div>
        <h2 className="mb-2 text-lg font-semibold">
          {isImporting ? "Importing..." : "Import Complete"}
        </h2>
        <p className="text-muted-foreground text-sm">
          {isImporting
            ? "Please wait while transactions are being imported..."
            : `Successfully imported ${totalSuccess} transaction${totalSuccess > 1 ? "s" : ""}${totalFailed > 0 ? ` (${totalFailed} failed)` : ""}`}
        </p>
      </div>

      {/* Import Progress */}
      {isImporting && importProgress && (
        <div className="rounded-lg border p-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-medium">
              {importProgress.message || "Importing transactions..."}
            </span>
            <span className="text-muted-foreground text-sm">
              {importProgress.current} / {importProgress.total}
            </span>
          </div>
          <ProgressIndicator
            value={(importProgress.current / importProgress.total) * 100}
            className="h-2"
          />
        </div>
      )}

      {/* Success Summary */}
      {!isImporting && totalSuccess > 0 && (
        <div className="rounded-lg border border-green-500/50 bg-green-50 p-4 dark:bg-green-900/10">
          <div className="flex items-start gap-3">
            <Icons.CheckCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-green-600" />
            <div>
              <p className="font-medium text-green-900 dark:text-green-100">Import Successful</p>
              <p className="text-muted-foreground mt-1 text-sm">
                {totalSuccess} transaction{totalSuccess > 1 ? "s" : ""} imported across{" "}
                {results.length} account{results.length > 1 ? "s" : ""}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Results by Account */}
      {!isImporting && results.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-medium">Import Results by Account</h3>
          <div className="space-y-2">
            {results.map((result) => (
              <div key={result.accountId} className="rounded-lg border p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="rounded bg-primary/10 px-2 py-0.5 text-xs font-medium">
                        {result.currency}
                      </span>
                      <span className="text-sm font-medium">{result.accountName}</span>
                    </div>
                    <div className="text-muted-foreground mt-1 flex items-center gap-4 text-xs">
                      <span className="flex items-center gap-1">
                        <Icons.CheckCircle className="h-3 w-3 text-green-600" />
                        {result.success} imported
                      </span>
                      {result.failed > 0 && (
                        <span className="flex items-center gap-1">
                          <Icons.AlertCircle className="h-3 w-3 text-red-500" />
                          {result.failed} failed
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-semibold">
                      {result.success + result.failed}
                    </p>
                    <p className="text-muted-foreground text-xs">total</p>
                  </div>
                </div>

                {/* Errors for this account */}
                {result.errors.length > 0 && (
                  <div className="mt-3 space-y-1">
                    {result.errors.slice(0, 3).map((error, index) => (
                      <p key={index} className="text-xs text-red-500">
                        • {error}
                      </p>
                    ))}
                    {result.errors.length > 3 && (
                      <p className="text-muted-foreground text-xs">
                        ... and {result.errors.length - 3} more errors
                      </p>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Error Summary */}
      {!isImporting && hasErrors && (
        <ImportAlert variant="warning" title="Some Transactions Failed">
          {allErrors.length} transaction{allErrors.length > 1 ? "s" : ""} could not be imported.
          Review the errors above for details.
        </ImportAlert>
      )}

      {/* Action Buttons */}
      {!isImporting && (
        <div className="flex justify-center">
          <Button onClick={onReset}>
            <Icons.Plus className="mr-2 h-4 w-4" />
            Import More Files
          </Button>
        </div>
      )}
    </div>
  );
};
