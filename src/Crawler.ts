import axios, { AxiosResponse, AxiosError } from "axios";
import { load } from "cheerio";
import { Readable } from "stream";
import { URL } from "url";

export interface PageResult {
  url: string;
  statusCode: number;
  latencyMs: number;
  type: "page" | "asset" | "error";
  errorMessage?: string;
  bodySizeExceeded?: boolean;
  bodySize?: number;
}

export interface CrawlResult {
  results: PageResult[];
  maxUrlsReached: boolean;
}

const REQUEST_TIMEOUT_MS = 5000;
const MAX_REDIRECTS = 5;


function isHtmlContent(response: AxiosResponse): boolean {
  return response.headers["content-type"]?.includes("text/html") ?? false;
}

function normalizeUrl(url: string): string {
  return url.replace(/#.*$/, ""); // Strip fragment identifiers
}

function extractErrorMessage(error: AxiosError | Error): string | undefined {
  if (axios.isAxiosError(error) && !error.response) {
    // Network-level error (no HTTP response received)
    // Common error codes: ENOTFOUND, ETIMEDOUT, ECONNREFUSED, ECONNRESET
    return error.code || error.message;
  }
  if (!axios.isAxiosError(error)) {
    return error.message;
  }
  return undefined;
}

function getStatusCode(error: AxiosError | Error): number {
  return axios.isAxiosError(error) ? (error.response?.status ?? 0) : 0;
}

async function readStreamBody(
  stream: Readable,
  maxBytes: number
): Promise<{ body: Buffer; truncated: boolean; totalBytes: number }> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  let truncated = false;

  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.length;
    if (truncated) {
      continue; // Already over limit, just draining for accurate latency
    }
    if (totalBytes >= maxBytes) {
      truncated = true;
      chunks.length = 0; // Free buffered data
      continue;
    }
    chunks.push(buffer);
  }

  return {
    body: truncated ? Buffer.alloc(0) : Buffer.concat(chunks),
    truncated,
    totalBytes,
  };
}

async function drainStream(stream: Readable): Promise<number> {
  let totalBytes = 0;
  for await (const chunk of stream) {
    totalBytes += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk);
  }
  return totalBytes;
}

export class Crawler {
  public static readonly DEFAULT_CONCURRENCY = 10;
  public static readonly DEFAULT_MAX_URLS = 2000;
  public static readonly DEFAULT_MAX_PAGE_SIZE = 5 * 1024 * 1024; // 5MB

  private readonly baseDomain: string;
  private readonly MAX_CONCURRENCY: number;
  private readonly maxUrls: number;
  private readonly maxPageSize: number;

  private visitedUrls = new Set<string>();
  private pendingUrls = new Set<string>();
  private results: PageResult[] = [];
  private maxUrlsReached = false;

  constructor(
    startUrl: string,
    maxConcurrency: number = Crawler.DEFAULT_CONCURRENCY,
    maxUrls: number = Crawler.DEFAULT_MAX_URLS,
    maxPageSize: number = Crawler.DEFAULT_MAX_PAGE_SIZE
  ) {
    try {
      const urlObj = new URL(startUrl);
      this.baseDomain = urlObj.hostname;
      this.pendingUrls.add(startUrl);
      this.MAX_CONCURRENCY = maxConcurrency;
      this.maxUrls = maxUrls;
      this.maxPageSize = maxPageSize;
    } catch (e) {
      throw new Error(`Invalid starting URL: ${startUrl}`);
    }
  }

  private shouldAddUrl(urlKey: string): boolean {
    try {
      const isSameDomain = new URL(urlKey).hostname === this.baseDomain;
      const isNotVisited = !this.visitedUrls.has(urlKey);
      const isNotPending = !this.pendingUrls.has(urlKey);

      return isSameDomain && isNotVisited && isNotPending;
    } catch {
      return false;
    }
  }

  private extractAndFilterLinks(html: string | Buffer, baseUrl: string): void {
    const htmlString = typeof html === 'string' ? html : html.toString();
    const $ = load(htmlString);

    $('a[href], img[src], link[rel="stylesheet"], script[src]').each(
      (i, element) => {
        const el = $(element);
        const href = el.attr("href") || el.attr("src");
        if (!href) return;

        try {
          const absoluteUrl = new URL(href, baseUrl).href;
          const normalizedUrl = normalizeUrl(absoluteUrl);

          if (this.shouldAddUrl(normalizedUrl)) {
            this.pendingUrls.add(normalizedUrl);
          }
        } catch {
          // Ignore malformed URLs
        }
      }
    );
  }

  private async fetchUrl(url: string): Promise<AxiosResponse> {
    return axios.get(url, {
      maxRedirects: MAX_REDIRECTS,
      timeout: REQUEST_TIMEOUT_MS,
      responseType: "stream",
      headers: {
        "User-Agent": "zhi/1.0.0 (Website Health Inspector)"
      }
    });
  }

  private createSuccessResult(
    url: string,
    response: AxiosResponse,
    latencyMs: number
  ): PageResult {
    return {
      url,
      statusCode: response.status,
      latencyMs,
      type: isHtmlContent(response) ? "page" : "asset",
    };
  }

  private createErrorResult(
    url: string,
    error: AxiosError | Error,
    latencyMs: number
  ): PageResult {
    return {
      url,
      statusCode: getStatusCode(error),
      latencyMs,
      type: "error",
      errorMessage: extractErrorMessage(error),
    };
  }

  private async processUrl(url: string): Promise<void> {
    if (this.visitedUrls.has(url)) return;
    this.visitedUrls.add(url);

    const startTime = Date.now();

    try {
      const response = await this.fetchUrl(url);
      const stream = response.data as Readable;

      if (isHtmlContent(response)) {
        const { body, truncated, totalBytes } = await readStreamBody(stream, this.maxPageSize);
        const latencyMs = Date.now() - startTime;
        const result = this.createSuccessResult(url, response, latencyMs);
        result.bodySize = totalBytes;
        if (truncated) {
          result.bodySizeExceeded = true;
        } else {
          this.extractAndFilterLinks(body, url);
        }
        this.results.push(result);
      } else {
        const totalBytes = await drainStream(stream);
        const latencyMs = Date.now() - startTime;
        const result = this.createSuccessResult(url, response, latencyMs);
        result.bodySize = totalBytes;
        this.results.push(result);
      }
    } catch (error) {
      const latencyMs = Date.now() - startTime;
      const err = error as AxiosError | Error;
      const result = this.createErrorResult(url, err, latencyMs);
      this.results.push(result);
    }
  }

  private getRemainingQuota(): number {
    return this.maxUrls - this.visitedUrls.size;
  }

  private checkMaxUrlsLimit(): void {
    if (this.getRemainingQuota() <= 0) {
      this.maxUrlsReached = true;
      this.pendingUrls.clear();
    }
  }

  private getUrlsToStart(
    availableSlots: number,
    remainingQuota: number
  ): string[] {
    const limit = Math.min(availableSlots, remainingQuota);
    return Array.from(this.pendingUrls).slice(0, Math.max(0, limit));
  }

  private createWorker(
    url: string,
    activeWorkers: Promise<void>[]
  ): Promise<void> {
    this.pendingUrls.delete(url);

    const worker = this.processUrl(url);
    const finishedWorker = worker.finally(() => {
      const index = activeWorkers.indexOf(finishedWorker);
      if (index !== -1) {
        activeWorkers.splice(index, 1);
      }
    });

    return finishedWorker;
  }

  public async startCrawl(): Promise<CrawlResult> {
    const activeWorkers: Promise<void>[] = [];

    while (this.pendingUrls.size > 0 || activeWorkers.length > 0) {
      this.checkMaxUrlsLimit();

      const availableSlots = this.MAX_CONCURRENCY - activeWorkers.length;
      const urlsToStart = this.getUrlsToStart(
        availableSlots,
        this.getRemainingQuota()
      );

      urlsToStart.forEach((url) => {
        const worker = this.createWorker(url, activeWorkers);
        activeWorkers.push(worker);
      });

      if (activeWorkers.length > 0) {
        await Promise.race(activeWorkers);
      }
    }

    return {
      results: this.results,
      maxUrlsReached: this.maxUrlsReached,
    };
  }
}
