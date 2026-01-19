# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.0] - 2025-01-19

### Added
- Flex Query API integration for automatic transaction fetching
- Auto-fetch on portfolio update feature
- Multiple Flex Query configuration support
- Smart deduplication between CSV and Flex Query imports
- Settings page for managing Flex Query configurations
- Secure credential storage using system keyring
- Source selection step in import wizard (CSV vs Flex Query)

### Changed
- Updated to Wealthfolio Addon SDK v2.0.0
- Improved UI with better step indicators
- Enhanced error handling and validation
- Better ticker resolution with caching

### Fixed
- Various edge cases in CSV parsing
- FX conversion splitting for complex scenarios

## [1.0.0] - 2025-01-01

### Added
- Initial release
- Multi-file CSV import support
- Automatic currency detection
- Multi-currency account creation
- ISIN-based ticker resolution
- FX conversion splitting
- Transaction type support (trades, dividends, fees, deposits, withdrawals, transfers)
- Account reuse detection
