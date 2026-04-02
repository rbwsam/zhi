# zhi 🕷️

A concurrent web crawler that detects slow pages, broken links, and unhealthy HTTP status codes across your site.

## Features

- **Concurrent crawling** - Process multiple pages simultaneously (default: 10 workers)
- **Comprehensive reporting** - Identifies slow responses, broken links, and HTTP errors
- **Smart link extraction** - Crawls HTML pages, CSS stylesheets, images, and scripts
- **Same-domain filtering** - Only crawls pages on the starting domain
- **Configurable limits** - Control concurrency and maximum URLs to crawl

## Requirements

- Node.js 20.0.0 or higher

## Installation

### From npm (Recommended)
```bash
npm install -g @rbwsam/zhi
zhi <url> [options]
```

### From source (Development)
```bash
git clone https://github.com/rbwsam/zhi.git
cd zhi
npm install
npm run build
node dist/index.js <url> [options]
```

## Quick Start

```bash
# Basic usage (https is assumed if no protocol specified)
zhi example.com

# With explicit protocol
zhi https://example.com
zhi http://example.com

# With custom concurrency
zhi example.com -c 20

# Limit total URLs to crawl
zhi example.com -m 500

# Combine options
zhi example.com -c 15 -m 1000
```

## Usage

```
zhi <url> [options]

Arguments:
  url                    The starting URL for the crawl

Options:
  -c, --concurrency <n>  Maximum number of concurrent requests (default: 10)
  -m, --max-urls <n>     Maximum number of unique URLs to crawl (default: 2000)
  -h, --help             Show this help message
  -V, --version          Show version number
```

## Reports

The tool generates a health report with three main sections:

### Slow Responses
Pages taking longer than 350ms to load. Sorted by latency (slowest first).

### Unhealthy Status Codes
Pages returning HTTP status codes > 299 or network errors.

### Summary
Total URLs processed and overall site health.

## Example Output

```
Starting crawl on https://example.com with 10 concurrent workers and max 2000 URLs.

======================================================
         🌐 Website Health Report for example.com
======================================================
Total URLs Processed: 42

## 🐢 Slow Responses (> 350ms) (3 found)
┌─────────────────────┬───────┬────────┬──────────────┐
│ URL                 │ Type  │ Status │ Latency (ms) │
├─────────────────────┼───────┼────────┼──────────────┤
│ https://example.com │ page  │ 200    │ 523          │
└─────────────────────┴───────┴────────┴──────────────┘

---

✅ All processed links returned healthy status codes (<= 299).

======================================================
```

## Development

### Build
```bash
npm run build
```

### Build and test
```bash
npm run build
node dist/index.js https://example.com
```

## License

MIT
