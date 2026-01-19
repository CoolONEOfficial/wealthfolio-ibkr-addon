import { Button } from "./simple-button";
import { Icons } from "./simple-icons";
import { useRef, useState } from "react";

interface MultiFileDropzoneProps {
  files: File[];
  onFilesChange: (files: File[]) => void;
  isLoading?: boolean;
  accept?: string;
}

export const MultiFileDropzone = ({
  files,
  onFilesChange,
  isLoading = false,
  accept = ".csv",
}: MultiFileDropzoneProps) => {
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const newFiles = Array.from(e.dataTransfer.files).filter((file) =>
        file.name.endsWith(".csv")
      );
      onFilesChange([...files, ...newFiles]);
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const newFiles = Array.from(e.target.files).filter((file) =>
        file.name.endsWith(".csv")
      );
      onFilesChange([...files, ...newFiles]);
    }
  };

  const handleClick = () => {
    if (!isLoading) {
      fileInputRef.current?.click();
    }
  };

  const handleRemoveFile = (index: number) => {
    const newFiles = [...files];
    newFiles.splice(index, 1);
    onFilesChange(newFiles);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleClearAll = () => {
    onFilesChange([]);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const getBorderClasses = () => {
    if (isDragging) {
      return "border-primary bg-primary/5";
    }
    if (files.length > 0) {
      return "border-green-500 bg-green-50 dark:bg-green-900/10";
    }
    return "border-border bg-background/50 hover:bg-background/80 hover:border-muted-foreground/50";
  };

  return (
    <div className="space-y-3">
      <div
        className={`group relative flex min-h-[120px] flex-col justify-center rounded-lg border border-dashed p-4 transition-colors ${getBorderClasses()} ${!isLoading ? "cursor-pointer" : ""}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={handleClick}
      >
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileInputChange}
          className="hidden"
          accept={accept}
          multiple
          disabled={isLoading}
        />

        <div className="flex flex-col items-center justify-center space-y-2">
          <div className="bg-muted flex h-10 w-10 items-center justify-center rounded-full shadow-sm">
            {isLoading ? (
              <Icons.Spinner className="h-5 w-5 animate-spin text-primary" />
            ) : files.length > 0 ? (
              <Icons.FileText className="h-5 w-5 text-green-600 dark:text-green-400" />
            ) : (
              <Icons.Import className="text-muted-foreground h-5 w-5" />
            )}
          </div>

          <div className="space-y-0.5 text-center">
            {isLoading ? (
              <p className="text-xs font-medium">Processing files...</p>
            ) : files.length > 0 ? (
              <>
                <p className="text-xs font-medium">
                  {files.length} file{files.length > 1 ? "s" : ""} selected
                </p>
                <p className="text-muted-foreground text-xs">
                  Click or drop to add more
                </p>
              </>
            ) : (
              <>
                <p className="text-xs font-medium">
                  <span className="text-primary">Click to upload</span> or drop files
                </p>
                <p className="text-muted-foreground text-xs">CSV files only</p>
              </>
            )}
          </div>
        </div>
      </div>

      {files.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">Selected Files ({files.length})</p>
              {files.length > 1 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleClearAll}
                  className="h-7 px-2 text-xs"
                >
                  <Icons.Trash className="mr-1 h-3 w-3" />
                  Clear All
                </Button>
              )}
            </div>

            <div className="max-h-[200px] space-y-1.5 overflow-y-auto rounded-lg border p-2">
              {files.map((file, index) => (
                <div
                  key={`${file.name}-${index}`}
                  className="bg-muted/50 hover:bg-muted group flex items-center justify-between rounded p-2 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <Icons.FileText className="text-muted-foreground h-4 w-4" />
                    <div>
                      <p className="text-xs font-medium">{file.name}</p>
                      <p className="text-muted-foreground text-xs">
                        {(file.size / 1024).toFixed(2)} KB
                      </p>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRemoveFile(index);
                    }}
                    className="h-7 w-7 p-0 opacity-0 transition-opacity group-hover:opacity-100"
                  >
                    <Icons.X className="h-3 w-3" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
      )}
    </div>
  );
};
