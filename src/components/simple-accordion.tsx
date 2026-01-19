import React, { createContext, useContext, useState, useEffect } from "react";
import { Icons } from "./simple-icons";

interface AccordionContextValue {
  openItems: string[];
  toggleItem: (value: string) => void;
  type: "single" | "multiple";
}

const AccordionContext = createContext<AccordionContextValue | undefined>(undefined);

interface AccordionProps {
  type?: "single" | "multiple";
  defaultValue?: string | string[];
  children: React.ReactNode;
  className?: string;
}

export const Accordion: React.FC<AccordionProps> = ({
  type = "single",
  defaultValue = [],
  children,
  className = "",
}) => {
  const [openItems, setOpenItems] = useState<string[]>(
    Array.isArray(defaultValue) ? defaultValue : defaultValue ? [defaultValue] : []
  );

  // Update openItems when defaultValue changes
  useEffect(() => {
    const newOpenItems = Array.isArray(defaultValue) ? defaultValue : defaultValue ? [defaultValue] : [];
    setOpenItems(newOpenItems);
  }, [defaultValue]);

  const toggleItem = (value: string) => {
    if (type === "single") {
      setOpenItems(openItems.includes(value) ? [] : [value]);
    } else {
      setOpenItems(
        openItems.includes(value)
          ? openItems.filter((item) => item !== value)
          : [...openItems, value]
      );
    }
  };

  return (
    <AccordionContext.Provider value={{ openItems, toggleItem, type }}>
      <div className={className}>{children}</div>
    </AccordionContext.Provider>
  );
};

// Context for passing value to child components
const AccordionItemContext = createContext<string | undefined>(undefined);

interface AccordionItemProps {
  value: string;
  children: React.ReactNode;
  className?: string;
}

export const AccordionItem: React.FC<AccordionItemProps> = ({
  value,
  children,
  className = "",
}) => {
  return (
    <AccordionItemContext.Provider value={value}>
      <div className={`border-b ${className}`}>
        {children}
      </div>
    </AccordionItemContext.Provider>
  );
};

interface AccordionTriggerProps {
  children: React.ReactNode;
  className?: string;
}

export const AccordionTrigger: React.FC<AccordionTriggerProps> = ({
  children,
  className = "",
}) => {
  const accordionContext = useContext(AccordionContext);
  const value = useContext(AccordionItemContext);

  if (!accordionContext) {
    throw new Error("AccordionTrigger must be used within Accordion");
  }

  if (!value) {
    throw new Error("AccordionTrigger must be used within AccordionItem");
  }

  const isOpen = accordionContext.openItems.includes(value);

  return (
    <button
      type="button"
      className={`flex w-full items-center justify-between py-4 text-left font-medium transition-all ${className}`}
      onClick={() => accordionContext.toggleItem(value)}
    >
      {children}
      <Icons.ChevronRight
        className={`h-4 w-4 shrink-0 transition-transform duration-200 ${
          isOpen ? "rotate-90" : ""
        }`}
      />
    </button>
  );
};

interface AccordionContentProps {
  children: React.ReactNode;
  className?: string;
}

export const AccordionContent: React.FC<AccordionContentProps> = ({
  children,
  className = "",
}) => {
  const accordionContext = useContext(AccordionContext);
  const value = useContext(AccordionItemContext);

  if (!accordionContext) {
    throw new Error("AccordionContent must be used within Accordion");
  }

  if (!value) {
    throw new Error("AccordionContent must be used within AccordionItem");
  }

  const isOpen = accordionContext.openItems.includes(value);

  if (!isOpen) return null;

  return (
    <div className={`overflow-hidden text-sm transition-all ${className}`}>
      {children}
    </div>
  );
};
