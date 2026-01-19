import { Button } from "./simple-button";
import { Input } from "@wealthfolio/ui";
import { Icons } from "./simple-icons";
import { HelpTooltip } from "./help-tooltip";
import { ImportAlert } from "./import-alert";
import type { AccountPreview } from "../types";

interface IBKRCurrencyPreviewStepProps {
  accountPreviews: AccountPreview[];
  onAccountPreviewChange: (index: number, name: string) => void;
  onBack: () => void;
  onNext: () => void;
}

export const IBKRCurrencyPreviewStep = ({
  accountPreviews,
  onAccountPreviewChange,
  onBack,
  onNext,
}: IBKRCurrencyPreviewStepProps) => {
  // Check for validation issues
  const accountNames = accountPreviews.map((a) => a.name.trim());
  const hasDuplicates = accountNames.some(
    (name, index) => accountNames.indexOf(name) !== index
  );

  const hasEmptyNames = accountPreviews.some((a) => a.name.trim().length === 0);

  // Check for currency mismatches (existing account with different currency)
  const currencyMismatches = accountPreviews.filter(
    (preview) =>
      preview.existingAccount &&
      preview.existingAccount.currency !== preview.currency
  );

  const hasErrors = hasDuplicates || hasEmptyNames || currencyMismatches.length > 0;

  const canProceed = !hasErrors && accountPreviews.length > 0;

  return (
    <div className="flex flex-col gap-6">
      {/* Header Info */}
      <div>
        <h2 className="mb-2 text-lg font-semibold">Currency Accounts Preview</h2>
        <p className="text-muted-foreground text-sm">
          Detected {accountPreviews.length} currency
          {accountPreviews.length > 1 ? "ies" : ""} across all files. Review and adjust
          account names if needed.
        </p>
      </div>

      {/* Account Preview Table */}
      <div className="rounded-lg border">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-muted/50 border-b">
                <th className="p-3 text-left text-xs font-medium">Currency</th>
                <th className="p-3 text-left text-xs font-medium">Transactions</th>
                <th className="p-3 text-left text-xs font-medium">
                  <div className="flex items-center gap-1">
                    Account Name
                    <HelpTooltip content="Edit account names if needed. Existing accounts will be reused if names match." />
                  </div>
                </th>
                <th className="p-3 text-left text-xs font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {accountPreviews.map((preview, index) => {
                const isDuplicate = accountNames.filter((name) => name === preview.name.trim()).length > 1;
                const isEmpty = preview.name.trim().length === 0;
                const hasMismatch =
                  preview.existingAccount &&
                  preview.existingAccount.currency !== preview.currency;

                return (
                  <tr key={preview.currency} className="border-b last:border-0">
                    <td className="p-3">
                      <span className="rounded bg-primary/10 px-2 py-1 text-sm font-medium">
                        {preview.currency}
                      </span>
                    </td>
                    <td className="p-3">
                      <span className="text-muted-foreground text-sm">
                        {preview.transactionCount}
                      </span>
                    </td>
                    <td className="p-3">
                      <Input
                        value={preview.name}
                        onChange={(e) => onAccountPreviewChange(index, e.target.value)}
                        className={`max-w-md ${isDuplicate || isEmpty || hasMismatch ? "border-red-500" : ""}`}
                      />
                      {isDuplicate && (
                        <p className="mt-1 text-xs text-red-500">Duplicate account name</p>
                      )}
                      {isEmpty && (
                        <p className="mt-1 text-xs text-red-500">Account name required</p>
                      )}
                      {hasMismatch && (
                        <p className="mt-1 text-xs text-red-500">
                          Existing account has currency {preview.existingAccount?.currency}
                        </p>
                      )}
                    </td>
                    <td className="p-3">
                      {preview.existingAccount && !hasMismatch ? (
                        <div className="flex items-center gap-1.5 text-xs">
                          <Icons.CheckCircle className="h-4 w-4 text-green-600" />
                          <span className="text-green-600">Will Reuse</span>
                        </div>
                      ) : hasMismatch ? (
                        <div className="flex items-center gap-1.5 text-xs">
                          <Icons.AlertCircle className="h-4 w-4 text-red-500" />
                          <span className="text-red-500">Mismatch</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5 text-xs">
                          <Icons.Plus className="h-4 w-4 text-blue-600" />
                          <span className="text-blue-600">Will Create</span>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Summary Info */}
      <div className="bg-muted/50 rounded-lg border p-4">
        <div className="flex items-start gap-2">
          <Icons.Info className="text-primary mt-0.5 h-4 w-4 flex-shrink-0" />
          <div className="text-sm">
            <p className="font-medium">What happens next:</p>
            <ul className="text-muted-foreground mt-1 space-y-1 text-xs">
              <li>
                • Existing accounts will be reused (transactions will be added to them)
              </li>
              <li>
                • New accounts will be created for currencies without matching accounts
              </li>
              <li>• All accounts will be part of the same account group</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Error Messages */}
      {hasDuplicates && (
        <ImportAlert variant="error" title="Duplicate Account Names">
          Multiple accounts cannot have the same name. Please adjust the names to be unique.
        </ImportAlert>
      )}

      {hasEmptyNames && (
        <ImportAlert variant="error" title="Empty Account Names">
          All accounts must have a name. Please provide a name for each account.
        </ImportAlert>
      )}

      {currencyMismatches.length > 0 && (
        <ImportAlert variant="error" title="Currency Mismatch">
          {currencyMismatches.length} existing account{currencyMismatches.length > 1 ? "s have" : " has"}{" "}
          a different currency. Please rename to avoid conflicts.
        </ImportAlert>
      )}

      {/* Action Buttons */}
      <div className="flex items-center justify-between">
        <Button variant="outline" onClick={onBack}>
          <Icons.ChevronLeft className="mr-1 h-4 w-4" />
          Back
        </Button>
        <Button onClick={onNext} disabled={!canProceed}>
          Next: Resolve Tickers
          <Icons.ChevronRight className="ml-1 h-4 w-4" />
        </Button>
      </div>
    </div>
  );
};
