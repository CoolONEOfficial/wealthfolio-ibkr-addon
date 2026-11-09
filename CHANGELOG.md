# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-11-09

### Changed
- Compatible with Wealthfolio 3.12 / Addon SDK 3.12 (sandboxed addon runtime); requires Wealthfolio 3.12+
- Pages moved into the addon route namespace: `/addons/ibkr-multi-import` (import) and `/addons/ibkr-multi-import/settings`
- Routes registered as host-mounted components; sidebar icons from the host icon set
- Flex Query and Yahoo Finance requests go through the host network broker (`ctx.api.network`, `manifest.network.allowedHosts`)
- Ticker cache stored via host addon storage (`ctx.api.storage`) instead of `localStorage`
- Manifest permissions updated to SDK 3 names (`events.onUpdateComplete`, `market-data.searchTicker`, `network.request`, `activities.getAll`); baseline `ui`/`logger` no longer declared
- Deduplication handles SDK 3 decimal strings for existing activities
- Build externalizes host-provided packages instead of mapping React globals

### Fixed
- Addon failed to load: "cannot register route '/activities/import/ibkr-multi'" and "not allowed to call events.onUpdateComplete"

## [1.0.0] - 2025-01-19

### Added
- Multi-file CSV import support
- Flex Query API integration for automatic transaction fetching
- Auto-fetch on portfolio update feature
- Multiple Flex Query configuration support
- Automatic currency detection and multi-currency account creation
- ISIN-based ticker resolution to Yahoo Finance symbols
- FX conversion splitting into withdrawal/deposit pairs
- Smart deduplication between CSV and Flex Query imports
- Settings page for managing Flex Query configurations
- Secure credential storage using system keyring
- Transaction type support (trades, dividends, fees, deposits, withdrawals, transfers)
- Account reuse detection
