import React from "react";
import { Icons } from "./simple-icons";

interface Step {
  id: number;
  title: string;
}

interface StepIndicatorProps {
  steps: Step[];
  currentStep: number;
}

const StepIndicator: React.FC<StepIndicatorProps> = ({ steps, currentStep }) => {
  return (
    <div className="flex items-center justify-between">
      {steps.map((step, index) => (
        <React.Fragment key={step.id}>
          <div className="flex flex-col items-center gap-2">
            <div
              className={`flex h-8 w-8 items-center justify-center rounded-full border-2 ${
                step.id < currentStep
                  ? "border-green-500 bg-green-500 text-white"
                  : step.id === currentStep
                    ? "border-primary bg-primary text-white"
                    : "border-gray-300 bg-white text-gray-400"
              }`}
            >
              {step.id < currentStep ? (
                <Icons.Check className="h-4 w-4" />
              ) : (
                <span className="text-sm font-semibold">{step.id}</span>
              )}
            </div>
            <span
              className={`text-xs font-medium ${
                step.id <= currentStep ? "text-foreground" : "text-muted-foreground"
              }`}
            >
              {step.title}
            </span>
          </div>
          {index < steps.length - 1 && (
            <div
              className={`h-0.5 flex-1 ${
                step.id < currentStep ? "bg-green-500" : "bg-gray-300"
              }`}
            />
          )}
        </React.Fragment>
      ))}
    </div>
  );
};

export default StepIndicator;
