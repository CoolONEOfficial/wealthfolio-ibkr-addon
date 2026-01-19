import React from "react";

interface AccountGroupSuggestionsProps {
  groups: string[];
  currentValue: string;
  onSelect: (group: string) => void;
}

export const AccountGroupSuggestions: React.FC<AccountGroupSuggestionsProps> = ({
  groups,
  currentValue,
  onSelect,
}) => {
  if (groups.length === 0) return null;

  return (
    <div className="space-y-1.5">
      <p className="text-xs text-muted-foreground">Existing groups:</p>
      <div className="flex flex-wrap gap-1.5">
        {groups.map((group) => (
          <button
            key={group}
            type="button"
            onClick={() => onSelect(group)}
            className={`inline-flex items-center rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
              currentValue === group
                ? "bg-primary text-primary-foreground"
                : "bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground"
            }`}
          >
            {group}
          </button>
        ))}
      </div>
    </div>
  );
};
