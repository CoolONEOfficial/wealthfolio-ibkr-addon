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

#### Step 1: Create Activity Flex Query

1. Log in to [IBKR Account Management](https://www.interactivebrokers.com/sso/Login)
2. Navigate to **Reports > Flex Queries > Activity Flex Query**
3. Click **Create** or **+** to add a new query

#### Step 2: Configure Required Sections

Add the following sections with their required fields:

<details>
<summary><b>Trades</b> (Required)</summary>

**Options:** Execution

**Required Fields:**
- ClientAccountID, CurrencyPrimary, FXRateToBase
- AssetClass, Symbol, Description, ISIN
- TradeID, DateTime, TradeDate, SettleDateTarget
- Quantity, TradePrice, Proceeds, Taxes, IBCommission, NetCash
- Buy/Sell, TransactionID

</details>

<details>
<summary><b>Cash Transactions</b> (Required)</summary>

**Options:** Dividends, Withholding Tax, 871(m) Withholding, Broker Fees, Deposits & Withdrawals, Detail

**Required Fields:**
- ClientAccountID, CurrencyPrimary, FXRateToBase
- AssetClass, Symbol, Description, ISIN
- Date/Time, SettleDate, Amount, Type
- TransactionID

</details>

<details>
<summary><b>Transfers</b> (Required)</summary>

**Options:** Transfer

**Required Fields:**
- ClientAccountID, CurrencyPrimary, FXRateToBase
- AssetClass, Symbol, Description, ISIN
- Date, DateTime, SettleDate
- Type, Direction, Quantity, TransferPrice
- TransactionID

</details>

<details>
<summary><b>Statement of Funds</b> (Optional - for FX conversions)</summary>

**Options:** Base Currency Summary

**Required Fields:**
- ClientAccountID, CurrencyPrimary, FXRateToBase
- Symbol, Description, ISIN
- ReportDate, Date, SettleDate
- ActivityCode, ActivityDescription
- Debit, Credit, Amount
- TransactionID

</details>

#### Step 3: Delivery Configuration

| Setting | Value |
|---------|-------|
| **Format** | CSV |
| **Include header and trailer records?** | No |
| **Include column headers?** | Yes |
| **Display single column header row?** | No |
| **Include section code and line descriptor?** | No |
| **Period** | Last 365 Calendar Days |

#### Step 4: General Configuration

| Setting | Value |
|---------|-------|
| **Date Format** | `yyyy-MM-dd` |
| **Time Format** | `HHmmss` |
| **Date/Time Separator** | `' '` (single-space) |
| **Include Canceled Trades?** | No |
| **Include Currency Rates?** | No |

#### Step 5: Generate Flex Web Service Token

1. In IBKR Account Management, go to **Reports > Flex Queries**
2. At the bottom, find **Flex Web Service**
3. Click **Generate Token** (or view existing token)
4. Copy and save the token securely

#### Step 6: Configure in Wealthfolio

1. Open Wealthfolio → **Activities > IBKR Settings**
2. Click **Add Configuration**
3. Enter your **Query ID** (shown at the top of your Flex Query)
4. Enter your **Flex Web Service Token**
5. Give it a name (e.g., "Main Account")
6. Enable **Auto-fetch on portfolio update** for automatic syncing

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
