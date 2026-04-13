#!/usr/bin/env node
import { Command } from "commander";
import { Crawler, PageResult } from "./Crawler";
import chalk from "chalk";
import Table from "cli-table3";

const SLOW_THRESHOLD_MS = 350;
const HEALTHY_STATUS_CODE_MAX = 299;


function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (bytes < 1024 * 1024) return `${Number.isInteger(kb) ? kb : kb.toFixed(1)} KB`;
  const mb = bytes / (1024 * 1024);
  return `${Number.isInteger(mb) ? mb : mb.toFixed(1)} MB`;
}

interface CliOptions {
  concurrency?: number;
  maxUrls?: number;
  maxPageSize?: number;
}

function validateAndNormalizeUrl(url: string): URL {
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(url);
  } catch {
    try {
      parsedUrl = new URL(`https://${url}`);
    } catch {
      console.error(`\n🚨 ERROR: Invalid URL format.`);
      process.exit(1);
    }
  }

  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    console.error(
      `\n🚨 ERROR: Invalid protocol "${parsedUrl.protocol}". Only http:// and https:// are supported.`
    );
    process.exit(1);
  }

  return parsedUrl;
}

function createTable(headers: string[]): Table.Table {
  return new Table({
    head: headers.map((h) => chalk.white.bold(h)),
    style: { head: [], border: [] },
  });
}

function printSlowResponsesReport(results: PageResult[]): void {
  const slowResponses = results.filter((r) => r.latencyMs > SLOW_THRESHOLD_MS);

  if (slowResponses.length === 0) {
    console.log(
      chalk.green(
        `\n🎉 No slow responses found above ${SLOW_THRESHOLD_MS}ms. Good job!`
      )
    );
    return;
  }

  console.log(
    chalk.yellow.bold(
      `\n🐢 Slow Responses (> ${SLOW_THRESHOLD_MS}ms) (${slowResponses.length} found)`
    )
  );

  const table = createTable(["URL", "Type", "Status", "Size", "Latency (ms)"]);

  slowResponses
    .sort((a, b) => b.latencyMs - a.latencyMs)
    .forEach((r) => {
      table.push([
        r.url,
        r.type,
        r.statusCode.toString(),
        r.bodySize != null ? formatBytes(r.bodySize) : "-",
        chalk.yellow(r.latencyMs.toString()),
      ]);
    });

  console.log(table.toString());
}

function printBodySizeExceededReport(results: PageResult[], maxPageSize: number): void {
  const exceeded = results.filter((r) => r.bodySizeExceeded);

  if (exceeded.length === 0) {
    return;
  }

  console.log(
    chalk.yellow.bold(
      `\n⚠️  Body Size Exceeded (> ${formatBytes(maxPageSize)}) (${exceeded.length} found)`
    )
  );
  console.log(
    chalk.gray(
      `Links on these pages were not extracted. Parts of the site may not have been crawled.`
    )
  );

  const table = createTable(["URL", "Status", "Size", "Latency (ms)"]);

  exceeded.forEach((r) => {
    table.push([
      r.url,
      r.statusCode.toString(),
      chalk.yellow(formatBytes(r.bodySize ?? 0)),
      r.latencyMs.toString(),
    ]);
  });

  console.log(table.toString());
}

function printUnhealthyStatusesReport(results: PageResult[]): void {
  const unhealthyStatuses = results.filter(
    (r) => r.statusCode === 0 || r.statusCode > HEALTHY_STATUS_CODE_MAX
  );

  if (unhealthyStatuses.length === 0) {
    console.log(
      chalk.green(
        `\n✅ All processed links returned healthy status codes (<= ${HEALTHY_STATUS_CODE_MAX}).`
      )
    );
    return;
  }

  const hasErrorDetails = unhealthyStatuses.some((r) => r.errorMessage);

  console.log(
    chalk.red.bold(
      `\n🚨 Unhealthy HTTP Status Codes (> ${HEALTHY_STATUS_CODE_MAX}) & Network Errors (${unhealthyStatuses.length} found)`
    )
  );

  const headers = ["URL", "Type", "Status", "Size", "Latency (ms)"];
  if (hasErrorDetails) {
    headers.push("Error Details");
  }

  const table = createTable(headers);

  unhealthyStatuses.forEach((r) => {
    const row = [
      r.url,
      r.type,
      chalk.red(r.statusCode.toString()),
      r.bodySize != null ? formatBytes(r.bodySize) : "-",
      r.latencyMs.toString(),
    ];
    if (hasErrorDetails) {
      row.push(r.errorMessage ? chalk.yellow(r.errorMessage) : "-");
    }
    table.push(row);
  });

  console.log(table.toString());
}

function generateReport(results: PageResult[], startUrl: string, maxPageSize: number): void {
  console.log(
    chalk.cyan.bold(`\n======================================================`)
  );
  console.log(
    chalk.cyan.bold(`         🌐 Website Health Report for ${startUrl}`)
  );
  console.log(
    chalk.cyan.bold(`======================================================`)
  );
  console.log(
    chalk.white(`Total URLs Processed: ${chalk.bold(results.length)}`)
  );
  console.log();

  printSlowResponsesReport(results);
  printBodySizeExceededReport(results, maxPageSize);
  printUnhealthyStatusesReport(results);

  console.log(
    chalk.cyan.bold(`\n======================================================`)
  );
}

const program = new Command();

program
  .description("A concurrent CLI tool to check website health.")
  .argument("<url>", "The starting URL for the crawl.")
  .option(
    "-c, --concurrency <number>",
    `The maximum number of concurrent requests (default: ${Crawler.DEFAULT_CONCURRENCY}).`,
    parseInt
  )
  .option(
    "-m, --max-urls <number>",
    `The maximum number of unique URLs to crawl (default: ${Crawler.DEFAULT_MAX_URLS}).`,
    parseInt
  )
  .option(
    "-s, --max-page-size <number>",
    `The maximum HTML page size in MB to parse for links (default: ${Crawler.DEFAULT_MAX_PAGE_SIZE / (1024 * 1024)}).`,
    parseFloat
  )
  .action(async (url: string, options: CliOptions) => {
    const parsedUrl = validateAndNormalizeUrl(url);
    const concurrency = options.concurrency ?? Crawler.DEFAULT_CONCURRENCY;
    const maxUrls = options.maxUrls ?? Crawler.DEFAULT_MAX_URLS;
    const maxPageSize = options.maxPageSize
      ? options.maxPageSize * 1024 * 1024
      : Crawler.DEFAULT_MAX_PAGE_SIZE;

    try {
      console.log(
        `Starting crawl on ${parsedUrl.href} with ${concurrency} concurrent workers, max ${maxUrls} URLs, and ${formatBytes(maxPageSize)} max page size.`
      );

      const crawler = new Crawler(parsedUrl.href, concurrency, maxUrls, maxPageSize);
      const { results, maxUrlsReached } = await crawler.startCrawl();

      if (maxUrlsReached) {
        console.warn(
          `\n[WARNING] Max URLs limit of ${maxUrls} reached. Stopping crawl.\n`
        );
      }

      generateReport(results, url, maxPageSize);
    } catch (error) {
      console.error(
        `\n🚨 FATAL ERROR: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      process.exit(1);
    }
  });

program.parse(process.argv);
