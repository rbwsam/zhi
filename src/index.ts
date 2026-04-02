#!/usr/bin/env node
import { Command } from "commander";
import { Crawler, PageResult } from "./Crawler";
import chalk from "chalk";
import Table from "cli-table3";

const SLOW_THRESHOLD_MS = 350;
const HEALTHY_STATUS_CODE_MAX = 299;

interface CliOptions {
  concurrency?: number;
  maxUrls?: number;
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
      `## 🐢 Slow Responses (> ${SLOW_THRESHOLD_MS}ms) (${slowResponses.length} found)`
    )
  );

  const table = createTable(["URL", "Type", "Status", "Latency (ms)"]);

  slowResponses
    .sort((a, b) => b.latencyMs - a.latencyMs)
    .forEach((r) => {
      table.push([
        r.url,
        r.type,
        r.statusCode.toString(),
        chalk.yellow(r.latencyMs.toString()),
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
      `## 🚨 Unhealthy HTTP Status Codes (> ${HEALTHY_STATUS_CODE_MAX}) & Network Errors (${unhealthyStatuses.length} found)`
    )
  );

  const headers = ["URL", "Type", "Status", "Latency (ms)"];
  if (hasErrorDetails) {
    headers.push("Error Details");
  }

  const table = createTable(headers);

  unhealthyStatuses.forEach((r) => {
    const row = [
      r.url,
      r.type,
      chalk.red(r.statusCode.toString()),
      r.latencyMs.toString(),
    ];
    if (hasErrorDetails) {
      row.push(r.errorMessage ? chalk.yellow(r.errorMessage) : "-");
    }
    table.push(row);
  });

  console.log(table.toString());
}

function generateReport(results: PageResult[], startUrl: string): void {
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
  console.log(`\n`);

  printSlowResponsesReport(results);
  console.log(chalk.gray("\n---"));
  printUnhealthyStatusesReport(results);

  console.log(
    chalk.cyan.bold(`\n======================================================`)
  );
}

const program = new Command();

program
  .version("1.0.0")
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
  .action(async (url: string, options: CliOptions) => {
    const parsedUrl = validateAndNormalizeUrl(url);
    const concurrency = options.concurrency ?? Crawler.DEFAULT_CONCURRENCY;
    const maxUrls = options.maxUrls ?? Crawler.DEFAULT_MAX_URLS;

    try {
      console.log(
        `Starting crawl on ${parsedUrl.href} with ${concurrency} concurrent workers and max ${maxUrls} URLs.`
      );

      const crawler = new Crawler(parsedUrl.href, concurrency, maxUrls);
      const { results, maxUrlsReached } = await crawler.startCrawl();

      if (maxUrlsReached) {
        console.warn(
          `\n[WARNING] Max URLs limit of ${maxUrls} reached. Stopping crawl.\n`
        );
      }

      generateReport(results, url);
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
