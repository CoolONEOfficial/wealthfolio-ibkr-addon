import { Icons } from "./simple-icons";
import React, { useState } from "react";

interface HelpTooltipProps {
  content: string;
}

export const HelpTooltip: React.FC<HelpTooltipProps> = ({ content }) => {
  const [isVisible, setIsVisible] = useState(false);

  return (
    <div
      className="relative inline-block"
      onMouseEnter={() => setIsVisible(true)}
      onMouseLeave={() => setIsVisible(false)}
    >
      <Icons.Info className="h-4 w-4 text-muted-foreground cursor-help" />
      {isVisible && (
        <div className="absolute z-50 w-64 p-2 bg-popover text-popover-foreground text-xs rounded-md shadow-lg bottom-full left-1/2 transform -translate-x-1/2 mb-2 border">
          {content}
          <div className="absolute bottom-0 left-1/2 transform -translate-x-1/2 translate-y-full">
            <div className="border-8 border-transparent border-t-popover" />
          </div>
        </div>
      )}
    </div>
  );
};
