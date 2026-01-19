/**
 * Normalizes and cleans numeric values from CSV data
 * Handles currency symbols, commas, spaces, and other formatting characters
 *
 * @param value The raw string value from CSV
 * @returns Cleaned numeric value or undefined if invalid
 */
export function normalizeNumericValue(value: string | undefined): number | undefined {
  if (!value || typeof value !== "string") {
    return undefined;
  }

  // Trim whitespace
  let cleaned = value.trim();

  // Handle empty strings
  if (cleaned === "" || cleaned === "-" || cleaned === "N/A" || cleaned.toLowerCase() === "null") {
    return undefined;
  }

  // Remove common currency symbols and formatting
  cleaned = cleaned
    .replace(/[$£€¥₹₦₹₽¢]/g, "") // Remove currency symbols
    .replace(/[,\s]/g, "") // Remove commas and spaces
    .replace(/[()]/g, "") // Remove parentheses (sometimes used for negative values)
    .trim();

  // Handle empty string after cleaning
  if (cleaned === "") {
    return undefined;
  }

  // Parse as float
  const parsed = parseFloat(cleaned);

  // Return undefined if parsing resulted in NaN
  return isNaN(parsed) ? undefined : parsed;
}

