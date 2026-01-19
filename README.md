# IBKR Multi-Currency Import Addon

A comprehensive import solution for Interactive Brokers (IBKR) activity statements with multi-currency support and Flex Query API integration.

## Features

- **CSV Import**: Upload multiple IBKR activity statement CSV files in a single import session
- **Flex Query API**: Automatically fetch transactions via IBKR Flex Query with configurable auto-fetch
- **Multi-Currency Support**: Automatically detects currencies and creates separate accounts per currency
- **ISIN-Based Ticker Resolution**: Resolves IBKR symbols to Yahoo Finance compatible tickers
- **FX Conversion Splitting**: Splits foreign exchange transactions into withdrawal/deposit pairs
- **Transaction Types**: Handles trades, dividends, fees, deposits, withdrawals, and transfers
- **Smart Deduplication**: Prevents duplicate imports when using both CSV and Flex Query

## Installation

### From GitHub Releases

1. Go to the [Releases](https://github.com/CoolONEOfficial/wealthfolio-ibkr-addon/releases) page
2. Download the latest `.zip` file
3. Open Wealthfolio → Settings → Addons
4. Click "Install from File" and select the downloaded ZIP
5. Enable the addon and grant required permissions

### From Wealthfolio Store

1. Open Wealthfolio → Settings → Addons → Store
2. Find "IBKR Multi-Currency Import"
3. Click Install

## Usage

### CSV Import

1. Navigate to **Activities > IBKR Multi-Import** from the sidebar
2. Select "Import from CSV Files"
3. Enter an account group name (e.g., "TFSA", "Trading")
4. Upload one or more IBKR activity statement CSV files
5. Review detected currencies and adjust account names if needed
6. Review the transaction preview with resolved tickers
7. Click "Start Import" to create accounts and import transactions

### Flex Query Setup

To use automatic transaction fetching via IBKR Flex Query API:

1. Log in to [IBKR Account Management](https://www.interactivebrokers.com/sso/Login)
2. Navigate to **Reports > Flex Queries**
3. Create a new Flex Query with the following settings:
   - **Report Type**: Activity Flex Query
   - **Include**: Trades, Cash Transactions, Transfers
   - **Date Period**: Last 365 Days (or your preference)
   - **Output Format**: CSV
4. Save and note your **Query ID**
5. Generate a **Flex Web Service Token** from the same page
6. In Wealthfolio, go to **Activities > IBKR Settings**
7. Add a new configuration with your Query ID and Token
8. Enable "Auto-fetch on portfolio update" for automatic syncing

## Import Workflow

### Step 1: Source Selection
Choose between CSV file import or Flex Query API fetch.

### Step 2: Group & Files (CSV) / Configuration (Flex Query)
- **CSV**: Enter group name and upload files
- **Flex Query**: Select saved configuration or enter credentials

### Step 3: Currency Accounts
- Review detected currencies
- Edit account names if needed (default: "{GroupName} - {Currency}")
- See which accounts already exist and will be reused

### Step 4: Transaction Preview
- View ticker resolution progress (ISIN → Yahoo tickers)
- Preview transactions grouped by currency account
- Review any failed ticker resolutions

### Step 5: Import Results
- View success/failure counts per account
- Navigate to accounts or activities to verify

## Supported IBKR Data

### Transaction Types
- Stock/ETF trades (BUY, SELL)
- Dividends
- Withholding taxes
- Broker fees and commissions
- Cash deposits and withdrawals
- Internal transfers
- Foreign exchange conversions

### CSV Format
The addon supports standard IBKR activity statement CSV exports containing:
- Multiple concatenated sections (trades, dividends, transfers)
- Multi-currency transaction data
- ISIN identifiers for securities

## Permissions

This addon requires the following permissions:

| Permission | Purpose |
|------------|---------|
| accounts.getAll, accounts.create | Create and manage multi-currency accounts |
| activities.import, activities.checkImport | Import transactions from CSV/API |
| assets.searchTicker | Resolve ISIN symbols to Yahoo Finance tickers |
| ui.sidebar.addItem, ui.router.add | Display import wizard and settings pages |
| secrets.get, secrets.set, secrets.delete | Securely store Flex Query credentials |
| events.portfolio.onUpdateComplete | Trigger automatic Flex Query fetch |
| logger.* | Log operations for debugging |

## Development

### Prerequisites

- Node.js 18+
- pnpm

### Setup

```bash
# Clone the repository
git clone https://github.com/CoolONEOfficial/wealthfolio-ibkr-addon.git
cd wealthfolio-ibkr-addon

# Install dependencies
pnpm install

# Build the addon
pnpm build

# Run in watch mode for development
pnpm dev
```

### Testing

```bash
# Run tests
pnpm test

# Run tests in watch mode
pnpm test:watch

# Type checking
pnpm type-check
```

### Building for Distribution

```bash
# Build and create distribution ZIP
pnpm bundle
```

The ZIP file will be created in `dist/`.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

MIT License - see [LICENSE](LICENSE) for details.

## Author

Nikolai Trukhin

## Links

- [GitHub Repository](https://github.com/CoolONEOfficial/wealthfolio-ibkr-addon)
- [Issue Tracker](https://github.com/CoolONEOfficial/wealthfolio-ibkr-addon/issues)
- [Wealthfolio](https://wealthfolio.app)
