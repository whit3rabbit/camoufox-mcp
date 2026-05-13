# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed
- The default `browse` wait strategy is now `load` so JavaScript verification pages have time to complete before content extraction.

## [1.5.0] - 2026-05-11

### Added
- Bounded JSON browse responses with text, HTML, and metadata output modes.
- CSS selector extraction and configurable output character limits.
- Server policy controls for unsafe browser options, concurrency, queue length, and screenshot limits.
- Initial URL, redirect, final URL, and browser request SSRF protections for local, private, link-local, and reserved address space.
- Local and Docker regression tests for blocked localhost targets and unsafe browser options.

### Changed
- Docker publishing targets `linux/amd64`.
- The default browse response returns visible text instead of raw HTML.

### Fixed
- CI now fails on local test failures.
- Local test runner now executes from the repository root.

## [1.1.0] - 2025-01-10

### Added
- Enhanced anti-detection features with OS auto-rotation
- Configurable wait strategies (domcontentloaded, load, networkidle)
- Custom timeout parameter (5-300 seconds)
- Humanize option for realistic cursor movements
- Locale configuration support
- Custom viewport dimensions
- Screenshot capture capability
- Comprehensive parameter validation with Zod
- Multi-architecture Docker support (amd64/arm64)
- NPM package configuration with executable binary
- GitHub Actions CI/CD pipeline

### Changed
- Upgraded from basic browse tool to enhanced parameter support
- Improved error handling and logging
- Better TypeScript type safety

### Fixed
- Docker container headless mode detection
- Browser cleanup on process termination

## [1.0.0] - 2025-01-09

### Added
- Initial release
- Basic browse tool with URL parameter
- MCP server implementation
- Docker support
- Camoufox browser integration
