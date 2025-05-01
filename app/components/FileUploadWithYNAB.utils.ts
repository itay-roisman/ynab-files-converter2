/**
 * Formats a monetary amount according to budget currency settings
 */
export const formatAmount = (amount: number, budgetId: string, budgets: any[]) => {
  const budget = budgets.find((b) => b.id === budgetId);
  if (!budget)
    return (
      new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        currencyDisplay: 'narrowSymbol',
      })
        .format(amount / 1000)
        .replace('$', '') + ' $'
    );

  const { currency_format } = budget;
  const formatter = new Intl.NumberFormat(currency_format.iso_code, {
    style: 'currency',
    currency: currency_format.iso_code,
    minimumFractionDigits: currency_format.decimal_digits,
    maximumFractionDigits: currency_format.decimal_digits,
    currencyDisplay: 'narrowSymbol',
  });

  // Remove the currency symbol from the beginning and add it to the end
  const formattedAmount = formatter.format(amount / 1000);
  const currencySymbol = currency_format.currency_symbol;
  return formattedAmount.replace(currencySymbol, '').trim() + ' ' + currencySymbol;
};

/**
 * Formats a date string to a localized date format
 */
export const formatDate = (date: string) => {
  return new Date(date).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
};

/**
 * Filters files based on supported file types
 */
export const filterSupportedFiles = (files: File[]) => {
  return files.filter(
    (file) =>
      file.type === 'text/csv' ||
      file.name.endsWith('.xls') ||
      file.name.endsWith('.xlsx') ||
      file.name.endsWith('.xlsm')
  );
};

/**
 * Processes files and returns analyzed FileWithYNAB objects
 */
export const processFiles = async (
  files: File[],
  budgets: any[],
  analyzeFile: (file: File) => Promise<any>,
  setIsAnalyzing: (value: boolean) => void,
  setSubmissionComplete: (value: boolean) => void,
  setSuccess: (value: string | null) => void,
  setAccountBalances: (value: Record<string, any[]>) => void
) => {
  // Reset submission status when new files are uploaded
  setSubmissionComplete(false);
  setSuccess(null);
  setAccountBalances({});

  setIsAnalyzing(true);
  try {
    // Get the primary budget
    const primaryBudget = budgets.reduce((oldest: any | null, current: any) => {
      if (!oldest) return current;
      return new Date(current.first_month) < new Date(oldest.first_month) ? current : oldest;
    }, null);

    // Get stored account mappings
    const storedMappings = JSON.parse(localStorage.getItem('identifierAccountMappings') || '{}');

    // Analyze each file and create FileWithYNAB objects
    const fileWithYNABArray = await Promise.all(
      files.map(async (file) => {
        const { identifier, rowCount, vendorInfo, transactions, finalBalance } =
          await analyzeFile(file);
        const accountId = identifier ? storedMappings[identifier] : '';

        return {
          file,
          budgetId: primaryBudget?.id || '',
          accountId,
          identifier,
          rowCount,
          vendorInfo,
          transactions,
          finalBalance,
        };
      })
    );

    return fileWithYNABArray;
  } finally {
    setIsAnalyzing(false);
  }
};
