#!/usr/bin/env node
import 'dotenv/config';
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import express from "express";
import { z } from "zod";
import * as sites from "./google/tools/sites.js";
import * as sitemaps from "./google/tools/sitemaps.js";
import * as analytics from "./google/tools/analytics.js";
import * as inspection from "./google/tools/inspection.js";
import * as pagespeed from "./google/tools/pagespeed.js";
import * as seoInsights from "./google/tools/seo-insights.js";
import * as seoPrimitives from "./common/tools/seo-primitives.js";
import * as schemaValidator from "./common/tools/schema-validator.js";
import * as advancedAnalytics from "./google/tools/advanced-analytics.js";
import * as sitesHealth from "./google/tools/sites-health.js";
import * as ga4Analytics from "./ga4/tools/analytics.js";
import * as ga4Realtime from "./ga4/tools/realtime.js";
import * as ga4Behavior from "./ga4/tools/behavior.js";
import * as ga4PageSpeed from "./ga4/tools/pagespeed.js";
import * as ga4GscComparator from "./common/tools/compare-engines/ga4-gsc-comparator.js";
import * as ga4Properties from "./ga4/tools/properties.js";
import { loadConfig, removeAccount, updateAccount, AccountConfig } from './common/auth/config.js';
import { resolveAccount, normalizeWebsite } from './common/auth/resolver.js';
import { getSearchConsoleClient, getUserEmail, DEFAULT_CLIENT_ID, DEFAULT_CLIENT_SECRET } from './google/client.js';
import { google } from 'googleapis';
import { limitConcurrency } from './common/concurrency.js';
import { formatError } from "./common/errors.js";
import { existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { colors, printBoxHeader, printStatusLine } from './utils/ui.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { getStartedHandler, getStartedToolName, getStartedToolDescription, getStartedToolSchema } from "./common/tools/get-started.js";
import { registerPrompts } from "./prompts/index.js";
import { jsonToCsv } from "./common/utils/csv.js";
import { runDiagnostics } from "./common/diagnostics.js";
import { logger } from "./utils/logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load version from package.json
let version = "1.0.0";
try {
  const pkgPath = join(__dirname, '../package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  version = pkg.version;
} catch (e) {
  // Fallback for cases where package.json might not be accessible
}

const server = new McpServer({
  name: "google-seo-mcp",
  version: version,
});

// Get Started Tool
server.tool(
  getStartedToolName,
  getStartedToolDescription,
  getStartedToolSchema,
  getStartedHandler
);

// Sites Tools
server.tool(
  "sites_list",
  "List all verified sites or properties across all authorized accounts",
  { engine: z.enum(["google", "ga4"]).optional().describe("The search engine (default: google)") },
  async ({ engine = "google" }) => {
    try {
      const config = await loadConfig();
      const accounts = Object.values(config.accounts).filter(a => a.engine === engine);

      const allResults = await limitConcurrency(accounts, 5, async (account) => {
        try {
          let results: any[];
          if (engine === "google") {
            results = await sites.listSites(account.id);
          } else if (engine === "ga4") {
            results = await ga4Properties.listProperties(account.id);
          } else {
            results = [];
          }

          const rawCount = results.length;
          // Boundary Filtering: Honor the website in the config
          if (account.websites && account.websites.length > 0) {
            results = results.filter(site => {
              const url = engine === "ga4" ? (site.propertyId) : (site.siteUrl || (site as any).Url);
              if (!url) return false;

              // If it's a numeric property ID (GA4), check direct inclusion
              if (engine === "ga4" && /^\d+$/.test(url)) {
                return account.websites!.includes(url);
              }

              try {
                const normalizedSite = normalizeWebsite(url).value;
                const isMatch = account.websites!.some(w => normalizeWebsite(w).value === normalizedSite);
                if (!isMatch) {
                  logger.debug(`Filtered out site ${url} for account ${account.alias} (not in whitelist)`);
                }
                return isMatch;
              } catch {
                return account.websites!.includes(url);
              }
            });
            logger.debug(`Account ${account.alias}: ${results.length}/${rawCount} sites kept after filtering.`);
          } else {
            logger.debug(`Account ${account.alias}: Found ${results.length} sites (no filtering).`);
          }

          return {
            account: account.alias,
            accountId: account.id,
            sites: results
          };
        } catch (e) {
          logger.error(`Failed to list sites for account ${account.alias}:`, (e as Error).message);
          return {
            account: account.alias,
            accountId: account.id,
            error: (e as Error).message
          };
        }
      });

      return {
        content: [{ type: "text", text: JSON.stringify(allResults, null, 2) }]
      };
    } catch (error) {
      return formatError(error);
    }
  }
);

server.tool(
  "sites_add",
  "Add a new site to Search Console",
  {
    siteUrl: z.string().describe("The URL of the site to add")
  },
  async ({ siteUrl }) => {
    try {
      const result = await sites.addSite(siteUrl);
      return {
        content: [{ type: "text", text: result }]
      };
    } catch (error) {
      return formatError(error);
    }
  }
);

server.tool(
  "sites_delete",
  "Remove a site from Search Console",
  {
    siteUrl: z.string().describe("The URL of the site to delete")
  },
  async ({ siteUrl }) => {
    try {
      const result = await sites.deleteSite(siteUrl);
      return {
        content: [{ type: "text", text: result }]
      };
    } catch (error) {
      return formatError(error);
    }
  }
);

server.tool(
  "sites_get",
  "Get information about a specific site",
  { siteUrl: z.string().describe("The URL of the site") },
  async ({ siteUrl }) => {
    try {
      const result = await sites.getSite(siteUrl);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    } catch (error) {
      return formatError(error);
    }
  }
);

server.tool(
  "sites_health_check",
  "Run a health check on one or all verified sites. Checks performance trends and status.",
  {
    siteUrl: z.string().optional().describe("Optional. The URL of a specific site to check.")
  },
  async ({ siteUrl }) => {
    try {
      const result = await sitesHealth.healthCheck(siteUrl);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    } catch (error) {
      return formatError(error);
    }
  }
);

// Sitemaps Tools
server.tool(
  "sitemaps_list",
  "List sitemaps for a site",
  {
    siteUrl: z.string().describe("The URL of the site")
  },
  async ({ siteUrl }) => {
    try {
      const results = await sitemaps.listSitemaps(siteUrl);
      return {
        content: [{ type: "text", text: JSON.stringify(results, null, 2) }]
      };
    } catch (error) {
      return formatError(error);
    }
  }
);

server.tool(
  "sitemaps_get",
  "Get details about a specific sitemap",
  {
    siteUrl: z.string().describe("The URL of the site"),
    feedpath: z.string().describe("The URL of the sitemap")
  },
  async ({ siteUrl, feedpath }) => {
    try {
      const result = await sitemaps.getSitemap(siteUrl, feedpath);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    } catch (error) {
      return formatError(error);
    }
  }
);

server.tool(
  "sitemaps_submit",
  "Submit a sitemap to Search Console",
  {
    siteUrl: z.string().describe("The URL of the site"),
    feedpath: z.string().describe("The URL of the sitemap")
  },
  async ({ siteUrl, feedpath }) => {
    try {
      const result = await sitemaps.submitSitemap(siteUrl, feedpath);
      return {
        content: [{ type: "text", text: result }]
      };
    } catch (error) {
      return formatError(error);
    }
  }
);

server.tool(
  "sitemaps_delete",
  "Delete a sitemap from Search Console",
  {
    siteUrl: z.string().describe("The URL of the site"),
    feedpath: z.string().describe("The URL of the sitemap")
  },
  async ({ siteUrl, feedpath }) => {
    try {
      const result = await sitemaps.deleteSitemap(siteUrl, feedpath);
      return {
        content: [{ type: "text", text: result }]
      };
    } catch (error) {
      return formatError(error);
    }
  }
);

// Analytics Tools
server.tool(
  "analytics_query",
  "Query search analytics data with optional pagination",
  {
    siteUrl: z.string().describe("The URL of the site"),
    startDate: z.string().describe("Start date (YYYY-MM-DD)"),
    endDate: z.string().describe("End date (YYYY-MM-DD)"),
    dimensions: z.array(z.string()).optional().describe("Dimensions to group by (date, query, page, country, device, searchAppearance)"),
    type: z.enum(["web", "image", "video", "news", "discover", "googleNews"]).optional().describe("Search type (default: web)"),
    aggregationType: z.enum(["auto", "byProperty", "byPage"]).optional().describe("How to aggregate data (default: auto)"),
    dataState: z.enum(["final", "all"]).optional().describe("Include fresh data? 'all' includes fresh (preliminary) data (default: final)"),
    limit: z.number().optional().describe("Max rows to return (default: 1000)"),
    startRow: z.number().optional().describe("Starting row for pagination (0-based)"),
    filters: z.array(z.object({
      dimension: z.string(),
      operator: z.string(),
      expression: z.string()
    })).optional().describe("Filters (dimension: query/page/country/device, operator: equals/contains/notContains/includingRegex/excludingRegex)"),
    format: z.enum(["json", "csv"]).optional().describe("Output format (default: json)")
  },
  async (args) => {
    try {
      const result = await analytics.queryAnalytics(args);

      if (args.format === 'csv') {
        const flatData = result.map(row => {
          const newRow: any = { ...row };
          if (row.keys && Array.isArray(row.keys)) {
            row.keys.forEach((keyVal, idx) => {
              const dimName = args.dimensions && args.dimensions[idx]
                ? args.dimensions[idx]
                : `dimension_${idx + 1}`;
              newRow[dimName] = keyVal;
            });
            delete newRow.keys;
          }
          return newRow;
        });
        return {
          content: [{ type: "text", text: jsonToCsv(flatData) }]
        };
      }

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    } catch (error) {
      return formatError(error);
    }
  }
);

server.tool(
  "analytics_performance_summary",
  "Get the aggregate performance metrics (clicks, impressions, CTR, position) for the last N days.",
  {
    siteUrl: z.string().describe("The URL of the site"),
    days: z.number().optional().describe("Number of days to look back (default: 28)")
  },
  async ({ siteUrl, days }) => {
    try {
      const result = await analytics.getPerformanceSummary(siteUrl, days);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    } catch (error) {
      return formatError(error);
    }
  }
);

server.tool(
  "analytics_compare_periods",
  "Compare performance metrics between two date periods. Useful for week-over-week or month-over-month analysis.",
  {
    siteUrl: z.string().describe("The URL of the site"),
    period1Start: z.string().describe("Start date of first (current) period (YYYY-MM-DD)"),
    period1End: z.string().describe("End date of first (current) period (YYYY-MM-DD)"),
    period2Start: z.string().describe("Start date of second (comparison) period (YYYY-MM-DD)"),
    period2End: z.string().describe("End date of second (comparison) period (YYYY-MM-DD)")
  },
  async ({ siteUrl, period1Start, period1End, period2Start, period2End }) => {
    try {
      const result = await analytics.comparePeriods(siteUrl, period1Start, period1End, period2Start, period2End);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    } catch (error) {
      return formatError(error);
    }
  }
);

server.tool(
  "analytics_top_queries",
  "Get top search queries by clicks or impressions for the last N days.",
  {
    siteUrl: z.string().describe("The URL of the site"),
    days: z.number().optional().describe("Number of days to look back (default: 28)"),
    limit: z.number().optional().describe("Number of top queries to return (default: 10)"),
    sortBy: z.enum(["clicks", "impressions"]).optional().describe("Sort by clicks or impressions (default: clicks)")
  },
  async ({ siteUrl, days, limit, sortBy }) => {
    try {
      const result = await analytics.getTopQueries(siteUrl, { days, limit, sortBy });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    } catch (error) {
      return formatError(error);
    }
  }
);

server.tool(
  "analytics_top_pages",
  "Get top performing pages by clicks or impressions for the last N days.",
  {
    siteUrl: z.string().describe("The URL of the site"),
    days: z.number().optional().describe("Number of days to look back (default: 28)"),
    limit: z.number().optional().describe("Number of top pages to return (default: 10)"),
    sortBy: z.enum(["clicks", "impressions"]).optional().describe("Sort by clicks or impressions (default: clicks)")
  },
  async ({ siteUrl, days, limit, sortBy }) => {
    try {
      const result = await analytics.getTopPages(siteUrl, { days, limit, sortBy });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    } catch (error) {
      return formatError(error);
    }
  }
);

server.tool(
  "analytics_by_country",
  "Get performance breakdown by country for the last N days.",
  {
    siteUrl: z.string().describe("The URL of the site"),
    days: z.number().optional().describe("Number of days to look back (default: 28)"),
    limit: z.number().optional().describe("Number of countries to return (default: 250)"),
    sortBy: z.enum(["clicks", "impressions"]).optional().describe("Sort by clicks or impressions (default: clicks)")
  },
  async ({ siteUrl, days, limit, sortBy }) => {
    try {
      const result = await analytics.getPerformanceByCountry(siteUrl, { days, limit, sortBy });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    } catch (error) {
      return formatError(error);
    }
  }
);

server.tool(
  "analytics_search_appearance",
  "Get performance breakdown by search appearance type for the last N days.",
  {
    siteUrl: z.string().describe("The URL of the site"),
    days: z.number().optional().describe("Number of days to look back (default: 28)"),
    limit: z.number().optional().describe("Number of types to return (default: 50)"),
    sortBy: z.enum(["clicks", "impressions"]).optional().describe("Sort by clicks or impressions (default: clicks)")
  },
  async ({ siteUrl, days, limit, sortBy }) => {
    try {
      const result = await analytics.getPerformanceBySearchAppearance(siteUrl, { days, limit, sortBy });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    } catch (error) {
      return formatError(error);
    }
  }
);

server.tool(
  "analytics_trends",
  "Detect traffic trends (rising/declining) for queries or pages.",
  {
    siteUrl: z.string().describe("The URL of the site"),
    dimension: z.enum(["query", "page"]).optional().describe("Dimension to analyze (default: query)"),
    days: z.number().optional().describe("Number of days to analyze (default: 28)"),
    threshold: z.number().optional().describe("Minimum percentage change to consider (default: 10)"),
    minClicks: z.number().optional().describe("Minimum clicks required to be considered (default: 100)"),
    limit: z.number().optional().describe("Max results to return (default: 20)")
  },
  async ({ siteUrl, dimension, days, threshold, minClicks, limit }) => {
    try {
      const result = await analytics.detectTrends(siteUrl, { dimension, days, threshold, minClicks, limit });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    } catch (error) {
      return formatError(error);
    }
  }
);

server.tool(
  "analytics_anomalies",
  "Identify unusual daily spikes or drops in traffic.",
  {
    siteUrl: z.string().describe("The URL of the site"),
    days: z.number().optional().describe("Number of days to look back for baseline (default: 30)"),
    threshold: z.number().optional().describe("Sensitivity threshold (Standard Deviations, default: 2.5)")
  },
  async ({ siteUrl, days, threshold }) => {
    try {
      const result = await analytics.detectAnomalies(siteUrl, { days, threshold });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    } catch (error) {
      return formatError(error);
    }
  }
);

server.tool(
  "analytics_drop_attribution",
  "Analyze a significant traffic drop to identify if it was caused by specific devices (mobile/desktop) or coincides with known Google algorithm updates.",
  {
    siteUrl: z.string().describe("The URL of the site"),
    days: z.number().optional().describe("Number of days to look back (default: 30)"),
    threshold: z.number().optional().describe("Sensitivity threshold for drop detection (Standard Deviations, default: 2.0)")
  },
  async ({ siteUrl, days, threshold }) => {
    try {
      const result = await advancedAnalytics.analyzeDropAttribution(siteUrl, { days, threshold });
      return {
        content: [{ type: "text", text: result ? JSON.stringify(result, null, 2) : "No significant traffic drop detected in the specified period." }]
      };
    } catch (error) {
      return formatError(error);
    }
  }
);

server.tool(
  "analytics_time_series",
  "Get advanced time series data including rolling averages, seasonality strength, and trend forecasting. Supports multi-dimensional analysis, metrics selection, and custom granularities.",
  {
    siteUrl: z.string().describe("The URL of the site"),
    days: z.number().optional().describe("Number of days of history to analyze (default: 60)"),
    startDate: z.string().optional().describe("Start date (YYYY-MM-DD)"),
    endDate: z.string().optional().describe("End date (YYYY-MM-DD)"),
    dimensions: z.array(z.string()).optional().describe("Dimensions to group by (default: ['date'])"),
    metrics: z.array(z.enum(["clicks", "impressions", "ctr", "position"])).optional().describe("Metrics to analyze (default: ['clicks'])"),
    granularity: z.enum(["daily", "weekly"]).optional().describe("Granularity of the data (default: daily)"),
    filters: z.array(z.object({
      dimension: z.string(),
      operator: z.string(),
      expression: z.string()
    })).optional().describe("Filter groups to apply"),
    window: z.number().optional().describe("Window size for rolling average in days/weeks (default: 7)"),
    forecastDays: z.number().optional().describe("Number of units (days/weeks) to forecast into the future (default: 7)")
  },
  async ({ siteUrl, days, startDate, endDate, dimensions, metrics, granularity, filters, window, forecastDays }) => {
    try {
      const result = await advancedAnalytics.getTimeSeriesInsights(siteUrl, {
        days,
        startDate,
        endDate,
        dimensions,
        metrics,
        granularity,
        filters,
        window,
        forecastDays
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    } catch (error) {
      return formatError(error);
    }
  }
);

// Inspection Tools
server.tool(
  "inspection_inspect",
  "Inspect a URL to check its indexing status, crawl info, and health",
  {
    siteUrl: z.string().describe("The URL of the property"),
    inspectionUrl: z.string().describe("The fully-qualified URL to inspect"),
    languageCode: z.string().optional().describe("Language code for localized results (Google only)")
  },
  async ({ siteUrl, inspectionUrl, languageCode }) => {
    try {
      const result = await inspection.inspectUrl(siteUrl, inspectionUrl, languageCode);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    } catch (error) {
      return formatError(error);
    }
  }
);

server.tool(
  "inspection_batch",
  "Inspect multiple URLs for a site in batch",
  {
    siteUrl: z.string().describe("The URL of the property"),
    inspectionUrls: z.array(z.string()).describe("List of URLs to inspect (max 5)"),
    languageCode: z.string().optional().describe("Language code for localized results (Google only)")
  },
  async ({ siteUrl, inspectionUrls, languageCode }) => {
    try {
      if (inspectionUrls.length > 5) {
        throw new Error("Batch inspection is limited to 5 URLs at a time to prevent rate limiting.");
      }

      const results = await inspection.inspectBatch(siteUrl, inspectionUrls, languageCode);

      return {
        content: [{ type: "text", text: JSON.stringify(results, null, 2) }]
      };
    } catch (error) {
      return formatError(error);
    }
  }
);

// PageSpeed Insights Tools
server.tool(
  "pagespeed_analyze",
  "Run PageSpeed Insights analysis on a URL to get performance, accessibility, best practices, and SEO scores",
  {
    url: z.string().describe("The URL to analyze"),
    strategy: z.enum(["mobile", "desktop"]).optional().describe("Device strategy (default: mobile)")
  },
  async ({ url, strategy }) => {
    try {
      const result = await pagespeed.analyzePageSpeed(url, strategy || 'mobile');
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    } catch (error) {
      return formatError(error);
    }
  }
);

server.tool(
  "pagespeed_core_web_vitals",
  "Get Core Web Vitals for both mobile and desktop including LCP, FID, CLS, FCP, TTI, and TBT",
  {
    url: z.string().describe("The URL to analyze")
  },
  async ({ url }) => {
    try {
      const result = await pagespeed.getCoreWebVitals(url);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    } catch (error) {
      return formatError(error);
    }
  }
);

// SEO Insights Tools
server.tool(
  "seo_recommendations",
  "Generate SEO recommendations based on site performance data",
  {
    siteUrl: z.string().describe("The site URL (e.g., https://example.com)"),
    days: z.number().optional().describe("Number of days to analyze (default: 28)")
  },
  async ({ siteUrl, days }) => {
    try {
      const result = await seoInsights.generateRecommendations(siteUrl, { days });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    } catch (error) {
      return formatError(error);
    }
  }
);

server.tool(
  "seo_low_hanging_fruit",
  "Find keywords with high impressions but low rankings that have potential for growth",
  {
    siteUrl: z.string().describe("The site URL"),
    days: z.number().optional().describe("Number of days (default: 28)"),
    minImpressions: z.number().optional().describe("Minimum impressions threshold (default: 100)"),
    limit: z.number().optional().describe("Max results to return (default: 50)")
  },
  async ({ siteUrl, days, minImpressions, limit }) => {
    try {
      const result = await seoInsights.findLowHangingFruit(siteUrl, { days, minImpressions, limit });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    } catch (error) {
      return formatError(error);
    }
  }
);

server.tool(
  "seo_cannibalization",
  "Detect keyword cannibalization - multiple pages competing for the same query",
  {
    siteUrl: z.string().describe("The site URL"),
    days: z.number().optional().describe("Number of days (default: 28)"),
    minImpressions: z.number().optional().describe("Minimum impressions threshold (default: 50)"),
    limit: z.number().optional().describe("Max issues to return (default: 30)")
  },
  async ({ siteUrl, days, minImpressions, limit }) => {
    try {
      const result = await seoInsights.detectCannibalization(siteUrl, { days, minImpressions, limit });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    } catch (error) {
      return formatError(error);
    }
  }
);

server.tool(
  "seo_low_ctr_opportunities",
  "Find queries with low CTR relative to their ranking position. Great for title tag optimization.",
  {
    siteUrl: z.string().describe("The site URL"),
    days: z.number().optional().describe("Number of days (default: 28)"),
    minImpressions: z.number().optional().describe("Minimum impressions threshold (default: 500)"),
    limit: z.number().optional().describe("Max issues to return (default: 50)")
  },
  async ({ siteUrl, days, minImpressions, limit }) => {
    try {
      const result = await seoInsights.findLowCTROpportunities(siteUrl, { days, minImpressions, limit });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    } catch (error) {
      return formatError(error);
    }
  }
);

server.tool(
  "seo_striking_distance",
  "Find keywords ranking in positions 8-15. These are high-priority targets to push to Page 1.",
  {
    siteUrl: z.string().describe("The site URL"),
    days: z.number().optional().describe("Number of days (default: 28)"),
    limit: z.number().optional().describe("Max results to return (default: 50)")
  },
  async ({ siteUrl, days, limit }) => {
    try {
      const result = await seoInsights.findStrikingDistance(siteUrl, { days, limit });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    } catch (error) {
      return formatError(error);
    }
  }
);

server.tool(
  "seo_lost_queries",
  "Identify queries that lost all traffic (or dropped >80%) compared to the previous period.",
  {
    siteUrl: z.string().describe("The site URL"),
    days: z.number().optional().describe("Number of days to compare (default: 28)"),
    limit: z.number().optional().describe("Max results to return (default: 50)")
  },
  async ({ siteUrl, days, limit }) => {
    try {
      const result = await seoInsights.findLostQueries(siteUrl, { days, limit });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    } catch (error) {
      return formatError(error);
    }
  }
);

server.tool(
  "seo_brand_vs_nonbrand",
  "Analyze performance split between Brand and Non-Brand queries using a regex.",
  {
    siteUrl: z.string().describe("The site URL"),
    brandRegex: z.string().describe("Regex to match brand keywords (e.g. 'acme|acme corp')"),
    days: z.number().optional().describe("Number of days to analyze (default: 28)")
  },
  async ({ siteUrl, brandRegex, days }) => {
    try {
      const result = await seoInsights.analyzeBrandVsNonBrand(siteUrl, brandRegex, { days });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    } catch (error) {
      return formatError(error);
    }
  }
);

server.tool(
  "seo_quick_wins",
  "Find pages with queries ranking on page 2 (positions 11-20) that could be pushed to page 1",
  {
    siteUrl: z.string().describe("The site URL"),
    days: z.number().optional().describe("Number of days (default: 28)"),
    minImpressions: z.number().optional().describe("Minimum impressions threshold (default: 100)"),
    limit: z.number().optional().describe("Max results to return (default: 20)")
  },
  async ({ siteUrl, days, minImpressions, limit }) => {
    try {
      const result = await seoInsights.findQuickWins(siteUrl, { days, minImpressions, limit });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    } catch (error) {
      return formatError(error);
    }
  }
);


// Account Management Tools
server.tool(
  "accounts_list",
  "List all authorized Google accounts",
  {},
  async () => {
    try {
      const config = await loadConfig();
      const accounts = Object.values(config.accounts).map(a => ({
        id: a.id,
        engine: a.engine,
        alias: a.alias,
        websites: a.websites || [],
        isLegacy: a.isLegacy || false
      }));
      return {
        content: [{ type: "text", text: JSON.stringify(accounts, null, 2) }]
      };
    } catch (error) {
      return formatError(error);
    }
  }
);

server.tool(
  "accounts_add_site",
  "Authorize a specific site or domain for an account (Account Boundary)",
  {
    accountId: z.string().describe("The ID of the account"),
    site: z.string().describe("The site URL or domain (e.g., example.com)")
  },
  async ({ accountId, site }) => {
    try {
      const config = await loadConfig();
      const account = config.accounts[accountId];
      if (!account) throw new Error(`Account ${accountId} not found.`);

      if (!account.websites) account.websites = [];
      const normalized = normalizeWebsite(site).value;
      if (!account.websites.includes(normalized)) {
        account.websites.push(normalized);
        await updateAccount(account);
      }

      return {
        content: [{ type: "text", text: `Successfully authorized ${site} for account ${account.alias}` }]
      };
    } catch (error) {
      return formatError(error);
    }
  }
);

server.tool(
  "accounts_remove",
  "Remove an authorized account",
  { accountId: z.string().describe("The ID of the account to remove") },
  async ({ accountId }) => {
    try {
      await removeAccount(accountId);
      return {
        content: [{ type: "text", text: `Account ${accountId} removed successfully.` }]
      };
    } catch (error) {
      return formatError(error);
    }
  }
);

// SEO Primitives (Atoms)
server.tool(
  "seo_primitive_ranking_bucket",
  "primitive: Get the ranking bucket for a specific position (e.g. Top 3, Page 1).",
  {
    position: z.number().describe("The ranking position")
  },
  async ({ position }) => {
    return {
      content: [{ type: "text", text: JSON.stringify(seoPrimitives.getRankingBucket(position, "google"), null, 2) }]
    };
  }
);

server.tool(
  "seo_primitive_traffic_delta",
  "primitive: Calculate the delta between two traffic metrics (absolute and percentage).",
  {
    current: z.number().describe("Current value"),
    previous: z.number().describe("Previous value")
  },
  async ({ current, previous }) => {
    return {
      content: [{ type: "text", text: JSON.stringify(seoPrimitives.calculateTrafficDelta(current, previous, "google"), null, 2) }]
    };
  }
);

server.tool(
  "seo_primitive_is_brand",
  "primitive: Check if a query is a brand query based on a regex pattern.",
  {
    query: z.string().describe("The search query"),
    brandRegex: z.string().describe("Regex pattern to identify brand terms")
  },
  async ({ query, brandRegex }) => {
    return {
      content: [{ type: "text", text: JSON.stringify(seoPrimitives.isBrandQuery(query, brandRegex, "google"), null, 2) }]
    };
  }
);

server.tool(
  "seo_primitive_is_cannibalized",
  "primitive: Check if two pages are competing for the same query based on their metrics.",
  {
    query: z.string().describe("The search query"),
    pageA_position: z.number(),
    pageA_impressions: z.number(),
    pageA_clicks: z.number(),
    pageB_position: z.number(),
    pageB_impressions: z.number(),
    pageB_clicks: z.number()
  },
  async ({ query, pageA_position, pageA_impressions, pageA_clicks, pageB_position, pageB_impressions, pageB_clicks }) => {
    const pageA = { position: pageA_position, impressions: pageA_impressions, clicks: pageA_clicks, engine: "google" as const };
    const pageB = { position: pageB_position, impressions: pageB_impressions, clicks: pageB_clicks, engine: "google" as const };
    return {
      content: [{ type: "text", text: JSON.stringify(seoPrimitives.isCannibalized(query, pageA, pageB), null, 2) }]
    };
  }
);

// Schema Validator Tools
server.tool(
  "schema_validate",
  "Validate Schema.org structured data (JSON-LD) from a URL, HTML snippet, or JSON object.",
  {
    type: z.enum(["url", "html", "json"]).describe("The type of input provided"),
    data: z.string().describe("The URL, HTML content, or JSON string to validate")
  },
  async ({ type, data }) => {
    try {
      const result = await schemaValidator.validateSchema(data, type as 'url' | 'html' | 'json');
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    } catch (error) {
      return formatError(error);
    }
  }
);

// Support Tools
server.tool(
  "util_star_repo",
  "Star the GitHub repository to support the project. Uses GitHub CLI if available, or opens a browser.",
  {},
  async () => {
    try {
      const { starRepository } = await import("./google/tools/support.js");
      const result = await starRepository();
      return {
        content: [{ type: "text", text: result }]
      };
    } catch (error) {
      return formatError(error);
    }
  }
);
// --- GA4 Tools ---

server.tool(
  "analytics_page_performance",
  "Get detailed page performance metrics from GA4 (sessions, views, engagement)",
  {
    propertyId: z.string().describe("GA4 Property ID"),
    accountId: z.string().optional().describe("GA4 account ID for multi-account setups"),
    startDate: z.string().describe("Start date (YYYY-MM-DD)"),
    endDate: z.string().describe("End date (YYYY-MM-DD)"),
    pagePath: z.string().optional().describe("Filter by specific page path"),
    limit: z.number().optional().describe("Max rows (default 50)"),
    offset: z.number().optional().describe("Starting row for pagination (0-based)"),
    format: z.enum(["json", "csv"]).optional().describe("Output format (default: json)")
  },
  async ({ propertyId, accountId, startDate, endDate, pagePath, limit, offset, format }) => {
    try {
      const result = await ga4Analytics.getPagePerformance(propertyId, startDate, endDate, pagePath, limit, accountId, offset);
      if (format === 'csv') {
        return {
          content: [{ type: "text", text: jsonToCsv(result) }]
        };
      }
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    } catch (error) {
      return formatError(error);
    }
  }
);

server.tool(
  "analytics_traffic_sources",
  "Analyze traffic sources (Channel, Source, Medium) in GA4",
  {
    propertyId: z.string().describe("GA4 Property ID"),
    accountId: z.string().optional().describe("GA4 account ID for multi-account setups"),
    startDate: z.string().describe("Start date (YYYY-MM-DD)"),
    endDate: z.string().describe("End date (YYYY-MM-DD)"),
    channelGroup: z.string().optional().describe("Filter by Channel Group (e.g. 'Organic Search')"),
    limit: z.number().optional().describe("Max rows (default 50)"),
    offset: z.number().optional().describe("Starting row for pagination (0-based)")
  },
  async ({ propertyId, accountId, startDate, endDate, channelGroup, limit, offset }) => {
    try {
      const result = await ga4Analytics.getTrafficSources(propertyId, startDate, endDate, channelGroup, limit, accountId, offset);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    } catch (error) {
      return formatError(error);
    }
  }
);

server.tool(
  "analytics_organic_landing_pages",
  "Get performance of organic landing pages in GA4 (matches GSC data)",
  {
    propertyId: z.string().describe("GA4 Property ID"),
    accountId: z.string().optional().describe("GA4 account ID for multi-account setups"),
    startDate: z.string().describe("Start date (YYYY-MM-DD)"),
    endDate: z.string().describe("End date (YYYY-MM-DD)"),
    limit: z.number().optional().describe("Max rows (default 50)"),
    offset: z.number().optional().describe("Starting row for pagination (0-based)")
  },
  async ({ propertyId, accountId, startDate, endDate, limit, offset }) => {
    try {
      const result = await ga4Analytics.getOrganicLandingPages(propertyId, startDate, endDate, limit, accountId, offset);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    } catch (error) {
      return formatError(error);
    }
  }
);

server.tool(
  "analytics_content_performance",
  "Analyze content performance by Content Group in GA4 (Requires Content Groups to be configured in GA4 Admin)",
  {
    propertyId: z.string().describe("GA4 Property ID"),
    accountId: z.string().optional().describe("GA4 account ID for multi-account setups"),
    startDate: z.string().describe("Start date (YYYY-MM-DD)"),
    endDate: z.string().describe("End date (YYYY-MM-DD)"),
    limit: z.number().optional().describe("Max rows (default 50)"),
    offset: z.number().optional().describe("Starting row for pagination (0-based)")
  },
  async ({ propertyId, accountId, startDate, endDate, limit, offset }) => {
    try {
      const result = await ga4Analytics.getContentPerformance(propertyId, startDate, endDate, limit, accountId, offset);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    } catch (error) {
      return formatError(error);
    }
  }
);

server.tool(
  "analytics_ecommerce",
  "Get ecommerce performance (products, revenue) from GA4",
  {
    propertyId: z.string().describe("GA4 Property ID"),
    accountId: z.string().optional().describe("GA4 account ID for multi-account setups"),
    startDate: z.string().describe("Start date (YYYY-MM-DD)"),
    endDate: z.string().describe("End date (YYYY-MM-DD)"),
    limit: z.number().optional().describe("Max rows (default 50)"),
    offset: z.number().optional().describe("Starting row for pagination (0-based)")
  },
  async ({ propertyId, accountId, startDate, endDate, limit, offset }) => {
    try {
      const result = await ga4Analytics.getEcommerce(propertyId, startDate, endDate, limit, accountId, offset);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    } catch (error) {
      return formatError(error);
    }
  }
);

server.tool(
  "analytics_realtime",
  "Get realtime active users broken down by page, country, and device",
  {
    propertyId: z.string().describe("GA4 Property ID"),
    accountId: z.string().optional().describe("GA4 account ID for multi-account setups")
  },
  async ({ propertyId, accountId }) => {
    try {
      const result = await ga4Realtime.getRealtimeData(propertyId, accountId);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    } catch (error) {
      return formatError(error);
    }
  }
);

server.tool(
  "analytics_user_behavior",
  "Get user behavior breakdown (Device, Country, Engagement) in a single batch",
  {
    propertyId: z.string().describe("GA4 Property ID"),
    accountId: z.string().optional().describe("GA4 account ID for multi-account setups"),
    startDate: z.string().describe("Start date (YYYY-MM-DD)"),
    endDate: z.string().describe("End date (YYYY-MM-DD)")
  },
  async ({ propertyId, accountId, startDate, endDate }) => {
    try {
      const result = await ga4Behavior.getUserBehavior(propertyId, startDate, endDate, accountId);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    } catch (error) {
      return formatError(error);
    }
  }
);

server.tool(
  "analytics_audience_segments",
  "Get audience segmentation (New vs Returning, Age, OS) in a single batch",
  {
    propertyId: z.string().describe("GA4 Property ID"),
    accountId: z.string().optional().describe("GA4 account ID for multi-account setups"),
    startDate: z.string().describe("Start date (YYYY-MM-DD)"),
    endDate: z.string().describe("End date (YYYY-MM-DD)")
  },
  async ({ propertyId, accountId, startDate, endDate }) => {
    try {
      const result = await ga4Behavior.getAudienceSegments(propertyId, startDate, endDate, accountId);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    } catch (error) {
      return formatError(error);
    }
  }
);

server.tool(
  "analytics_conversion_funnel",
  "Analyze top converting pages and events",
  {
    propertyId: z.string().describe("GA4 Property ID"),
    accountId: z.string().optional().describe("GA4 account ID for multi-account setups"),
    startDate: z.string().describe("Start date (YYYY-MM-DD)"),
    endDate: z.string().describe("End date (YYYY-MM-DD)"),
    eventName: z.string().optional().describe("Filter by specific event name")
  },
  async ({ propertyId, accountId, startDate, endDate, eventName }) => {
    try {
      const result = await ga4Behavior.getConversionFunnel(propertyId, startDate, endDate, eventName, accountId);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    } catch (error) {
      return formatError(error);
    }
  }
);

server.tool(
  "analytics_pagespeed_correlation",
  "Correlate GA4 engagement metrics with PageSpeed Insights scores for top organic pages",
  {
    propertyId: z.string().describe("GA4 Property ID"),
    accountId: z.string().optional().describe("GA4 account ID for multi-account setups"),
    domain: z.string().describe("The domain of the site (e.g. example.com) to construct URLs"),
    startDate: z.string().describe("Start date (YYYY-MM-DD)"),
    endDate: z.string().describe("End date (YYYY-MM-DD)"),
    limit: z.number().optional().describe("Number of pages to analyze (default 5)"),
    strategy: z.enum(["mobile", "desktop"]).optional().describe("PageSpeed strategy (default mobile)")
  },
  async ({ propertyId, accountId, domain, startDate, endDate, limit, strategy }) => {
    try {
      const result = await ga4PageSpeed.getPageSpeedCorrelation(propertyId, domain, startDate, endDate, limit, strategy, accountId);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    } catch (error) {
      return formatError(error);
    }
  }
);

// --- Cross-Platform Tools ---

server.tool(
  "page_analysis",
  "Compare GSC ranking data with GA4 behavior data for top pages to find opportunities",
  {
    gscSiteUrl: z.string().describe("GSC Site URL"),
    ga4PropertyId: z.string().describe("GA4 Property ID"),
    startDate: z.string().describe("Start date (YYYY-MM-DD)"),
    endDate: z.string().describe("End date (YYYY-MM-DD)"),
    limit: z.number().optional().describe("Max pages (default 50)"),
    ga4AccountId: z.string().optional().describe("Optional GA4 account ID"),
    gscAccountId: z.string().optional().describe("Optional GSC account ID")
  },
  async ({ gscSiteUrl, ga4PropertyId, startDate, endDate, limit, ga4AccountId, gscAccountId }) => {
    try {
      const result = await ga4GscComparator.analyzePagesCrossPlatform(gscSiteUrl, ga4PropertyId, startDate, endDate, limit, ga4AccountId, gscAccountId);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    } catch (error) {
      return formatError(error);
    }
  }
);

server.tool(
  "traffic_health_check",
  "Diagnose tracking issues by comparing GSC clicks vs GA4 organic sessions",
  {
    gscSiteUrl: z.string().describe("GSC Site URL"),
    ga4PropertyId: z.string().describe("GA4 Property ID"),
    startDate: z.string().describe("Start date (YYYY-MM-DD)"),
    endDate: z.string().describe("End date (YYYY-MM-DD)"),
    ga4AccountId: z.string().optional().describe("Optional GA4 account ID"),
    gscAccountId: z.string().optional().describe("Optional GSC account ID")
  },
  async ({ gscSiteUrl, ga4PropertyId, startDate, endDate, ga4AccountId, gscAccountId }) => {
    try {
      const result = await ga4GscComparator.checkTrafficHealth(gscSiteUrl, ga4PropertyId, startDate, endDate, ga4AccountId, gscAccountId);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    } catch (error) {
      return formatError(error);
    }
  }
);

server.tool(
  "opportunity_matrix",
  "Prioritize SEO tasks by combining signals from GSC and GA4",
  {
    gscSiteUrl: z.string().describe("GSC Site URL"),
    ga4PropertyId: z.string().describe("GA4 Property ID"),
    startDate: z.string().describe("Start date (YYYY-MM-DD)"),
    endDate: z.string().describe("End date (YYYY-MM-DD)"),
    limit: z.number().optional().describe("Max results (default 20)"),
    ga4AccountId: z.string().optional().describe("Optional GA4 account ID"),
    gscAccountId: z.string().optional().describe("Optional GSC account ID")
  },
  async ({ gscSiteUrl, ga4PropertyId, startDate, endDate, limit, ga4AccountId, gscAccountId }) => {
    try {
      const result = await ga4GscComparator.analyzePagesCrossPlatform(gscSiteUrl, ga4PropertyId, startDate, endDate, limit, ga4AccountId, gscAccountId);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    } catch (error) {
      return formatError(error);
    }
  }
);

server.tool(
  "brand_analysis",
  "Analyze Brand vs Non-Brand performance across GSC and GA4",
  {
    brandTerms: z.array(z.string()).describe("List of brand keywords"),
    gscSiteUrl: z.string().describe("GSC Site URL"),
    ga4PropertyId: z.string().describe("GA4 Property ID"),
    startDate: z.string().describe("Start date (YYYY-MM-DD)"),
    endDate: z.string().describe("End date (YYYY-MM-DD)"),
    ga4AccountId: z.string().optional().describe("Optional GA4 account ID"),
    gscAccountId: z.string().optional().describe("Optional GSC account ID")
  },
  async ({ brandTerms, gscSiteUrl, ga4PropertyId, startDate, endDate, ga4AccountId, gscAccountId }) => {
    try {
      const result = await ga4GscComparator.getBrandAnalysis(brandTerms, gscSiteUrl, ga4PropertyId, startDate, endDate, ga4AccountId, gscAccountId);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    } catch (error) {
      return formatError(error);
    }
  }
);

server.resource(
  "sites",
  "sites://list",
  async (uri) => {
    const result = await sites.listSites();
    return {
      contents: [{
        uri: uri.href,
        text: JSON.stringify(result, null, 2),
        mimeType: "application/json"
      }]
    };
  }
);

server.resource(
  "sitemaps",
  "sitemaps://list/{siteUrl}",
  async (uri) => {
    const siteUrl = decodeURIComponent(uri.pathname.replace('/list/', ''));
    const result = await sitemaps.listSitemaps(siteUrl);
    return {
      contents: [{
        uri: uri.href,
        text: JSON.stringify(result, null, 2),
        mimeType: "application/json"
      }]
    };
  }
);

server.resource(
  "analytics-summary",
  "analytics://summary/{siteUrl}",
  async (uri) => {
    const siteUrl = decodeURIComponent(uri.pathname.replace('/summary/', ''));
    const result = await analytics.getPerformanceSummary(siteUrl);
    return {
      contents: [{
        uri: uri.href,
        text: JSON.stringify(result, null, 2),
        mimeType: "application/json"
      }]
    };
  }
);

// Documentation Resources
import { dimensionsDocs, filtersDocs, searchTypesDocs, patternsDocs, algorithmUpdatesDocs } from "./google/docs/index.js";

server.resource(
  "docs-dimensions",
  "docs://dimensions",
  async (uri) => ({
    contents: [{
      uri: uri.href,
      text: dimensionsDocs,
      mimeType: "text/markdown"
    }]
  })
);

server.resource(
  "docs-filters",
  "docs://filters",
  async (uri) => ({
    contents: [{
      uri: uri.href,
      text: filtersDocs,
      mimeType: "text/markdown"
    }]
  })
);

server.resource(
  "docs-search-types",
  "docs://search-types",
  async (uri) => ({
    contents: [{
      uri: uri.href,
      text: searchTypesDocs,
      mimeType: "text/markdown"
    }]
  })
);

server.resource(
  "docs-patterns",
  "docs://patterns",
  async (uri) => ({
    contents: [{
      uri: uri.href,
      text: patternsDocs,
      mimeType: "text/markdown"
    }]
  })
);

server.resource(
  "docs-algorithm-updates",
  "docs://algorithm-updates",
  async (uri) => ({
    contents: [{
      uri: uri.href,
      text: algorithmUpdatesDocs,
      mimeType: "text/markdown"
    }]
  })
);

// Prompts
server.prompt(
  "analyze-site-performance",
  {
    siteUrl: z.string().describe("The URL of the site to analyze"),
    engine: z.enum(["google", "ga4"]).optional().describe("The search engine to use (default: google)"),
    startDate: z.string().optional().describe("Start date (YYYY-MM-DD), defaults to 1 month ago"),
    endDate: z.string().optional().describe("End date (YYYY-MM-DD), defaults to today")
  },
  ({ siteUrl, engine = "google", startDate, endDate }) => {
    const end = endDate || new Date().toISOString().split('T')[0];
    const start = startDate || (() => {
      const d = new Date();
      d.setMonth(d.getMonth() - 1);
      return d.toISOString().split('T')[0];
    })();

    return {
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: `Please analyze the performance of the site ${siteUrl} on ${engine === 'google' ? 'Google Search Console' : 'GA4'} for the period ${start} to ${end}.
        
        ${engine === 'google'
              ? `Use the 'analytics_query' tool with startDate='${start}' and endDate='${end}' to get detailed metrics.`
              : `Use the 'analytics_page_performance' and 'analytics_traffic_sources' tools with propertyId='[PROPERTY_ID]', startDate='${start}' and endDate='${end}'.`}
        
        Provide a summary of the site's health and any opportunities for improvement on ${engine === 'google' ? 'Google' : 'GA4'}.`
        }
      }]
    };
  }
);

server.prompt(
  "compare-performance",
  {
    siteUrl: z.string().describe("The URL of the site to analyze"),
    engine: z.enum(["google", "ga4"]).optional().describe("The search engine to use (default: google)"),
    months: z.number().optional().describe("Number of months to compare (default: 1)")
  },
  ({ siteUrl, engine = "google", months = 1 }) => {
    const end1 = new Date().toISOString().split('T')[0];
    const start1 = (() => {
      const d = new Date();
      d.setMonth(d.getMonth() - months);
      return d.toISOString().split('T')[0];
    })();
    const end2 = start1;
    const start2 = (() => {
      const d = new Date();
      d.setMonth(d.getMonth() - (months * 2));
      return d.toISOString().split('T')[0];
    })();

    return {
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: `Compare the performance of ${siteUrl} on ${engine === 'google' ? 'Google' : 'GA4'} for the period ${start1} to ${end1} vs ${start2} to ${end2}.

${engine === 'google'
              ? `Use the 'analytics_compare_periods' tool with:
- period1Start: '${start1}', period1End: '${end1}'
- period2Start: '${start2}', period2End: '${end2}'

Analyze the changes in clicks, impressions, CTR, and position.
If there are notable changes, use 'analytics_top_queries' to identify which queries are driving the change.`
              : `Use the 'analytics_page_performance' tool twice (once for each period: ${start1} to ${end1} and ${start2} to ${end2}) to compare sessions and engagement.
Analyze changes in key metrics and identify top performing pages.`
            }`
        }
      }]
    };
  }
);

server.prompt(
  "find-declining-pages",
  {
    siteUrl: z.string().describe("The URL of the site to analyze"),
    engine: z.enum(["google", "ga4"]).optional().describe("The search engine to use (default: google)"),
    months: z.number().optional().describe("Number of months to analyze (default: 1)")
  },
  ({ siteUrl, engine = "google", months = 1 }) => {
    const end = new Date().toISOString().split('T')[0];
    const start = (() => {
      const d = new Date();
      d.setMonth(d.getMonth() - months);
      return d.toISOString().split('T')[0];
    })();

    return {
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: `Find pages on ${siteUrl} that are losing traffic on ${engine === 'google' ? 'Google' : 'GA4'} between ${start} and ${end}.

${engine === 'google'
              ? `Steps:
1. Use 'analytics_compare_periods' to compare this period (${start} to ${end}) vs the previous ${months} month(s)
2. Use 'analytics_query' with dimension 'page' to get page-level data
3. Identify pages with significant click/impression drops`
              : `Steps:
1. Use 'analytics_page_performance' for the current period and compare it to historical data.
2. Identify landing pages with significant drops in sessions or engagement.`
            }

For each declining page, provide:
- The URL
- Previous vs current performance
- Possible reasons and recommendations`
        }
      }]
    };
  }
);

server.prompt(
  "keyword-opportunities",
  {
    siteUrl: z.string().describe("The URL of the site to analyze"),
    engine: z.enum(["google", "ga4"]).optional().describe("The search engine to use (default: google)"),
    months: z.number().optional().describe("Number of months of data to analyze (default: 3)")
  },
  ({ siteUrl, engine = "google", months = 3 }) => {
    const end = new Date().toISOString().split('T')[0];
    const start = (() => {
      const d = new Date();
      d.setMonth(d.getMonth() - months);
      return d.toISOString().split('T')[0];
    })();

    return {
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: `Find keyword opportunities for ${siteUrl} on ${engine === 'google' ? 'Google' : 'GA4'} for the last ${months} months (${start} to ${end}).
        
${engine === 'google'
              ? "Use 'analytics_top_queries' or 'seo_low_hanging_fruit' to find high-potential targets."
              : `Note: GA4 does not provide keyword-level data. Use 'analytics_organic_landing_pages' to find top organic pages and 'analytics_page_performance' to identify engagement opportunities.`}
        
        Analyze for:
        1. **Low CTR, High Impressions**: Queries where you rank but don't get clicks
        2. **High Position (>10), Good Impressions**: Queries not on page 1 (Striking Distance)
        3. **New Ranking Queries**: Queries that appeared recently (use comparison tools)
        
        Provide specific recommendations for the top 5 opportunities.`
        }
      }]
    };
  }
);

server.prompt(
  "new-content-impact",
  {
    siteUrl: z.string().describe("The URL of the site"),
    pageUrl: z.string().describe("The URL of the new content to analyze"),
    engine: z.enum(["google", "ga4"]).optional().describe("The search engine to use (default: google)"),
    months: z.number().optional().describe("Number of months to analyze (default: 1)")
  },
  ({ siteUrl, pageUrl, engine = "google", months = 1 }) => {
    const end = new Date().toISOString().split('T')[0];
    const start = (() => {
      const d = new Date();
      d.setMonth(d.getMonth() - months);
      return d.toISOString().split('T')[0];
    })();

    return {
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: `Analyze the impact of new content at ${pageUrl} on site ${siteUrl} in ${engine === 'google' ? 'Google' : 'GA4'} for the period ${start} to ${end}.

1. Use '${engine === 'google' ? 'inspection_inspect' : 'analytics_page_performance'}' to check status.
2. Use '${engine === 'google' ? 'analytics_query' : 'analytics_page_performance'}' with startDate='${start}' and endDate='${end}' to get performance for this specific URL.
3. Identify which queries (GSC) or traffic sources (GA4) are driving traffic to this page.

Provide:
- Indexing status
- Key metrics (clicks, impressions, CTR, position)
- Top queries ranking for this page
- Recommendations for improvement`
        }
      }]
    };
  }
);

server.prompt(
  "mobile-vs-desktop",
  {
    siteUrl: z.string().describe("The URL of the site to analyze"),
    engine: z.enum(["google", "ga4"]).optional().describe("The search engine to use (default: google)"),
    months: z.number().optional().describe("Number of months to analyze (default: 1)")
  },
  ({ siteUrl, engine = "google", months = 1 }) => {
    const end = new Date().toISOString().split('T')[0];
    const start = (() => {
      const d = new Date();
      d.setMonth(d.getMonth() - months);
      return d.toISOString().split('T')[0];
    })();

    return {
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: `Compare mobile vs desktop performance for ${siteUrl} on ${engine === 'google' ? 'Google' : 'GA4'} from ${start} to ${end}.

${engine === 'google'
              ? `Use 'analytics_query' with dimension 'device', startDate='${start}', and endDate='${end}' to get device-level metrics.`
              : `Use 'analytics_user_behavior' to get a full device breakdown (Mobile vs Desktop vs Tablet) for GA4.`}

Analyze:
1. Click and impression distribution across devices (if data available)
2. CTR differences
3. Position ranking differences

If there's a significant gap, investigate:
- Use '${engine === 'google' ? 'inspection_inspect' : 'analytics_page_performance'}' on key pages to check health/usability.
- Recommend specific improvements.

Provide a summary with actionable recommendations.`
        }
      }]
    };
  }
);

server.prompt(
  "site-health-check",
  {
    siteUrl: z.string().optional().describe("Optional. The URL of a specific site to check."),
    engine: z.enum(["google", "ga4"]).optional().describe("The search engine to use (default: google)"),
    months: z.number().optional().describe("Number of months to analyze for trends (default: 1)")
  },
  ({ siteUrl, engine = "google", months = 1 }) => {
    const end = new Date().toISOString().split('T')[0];
    const start = (() => {
      const d = new Date();
      d.setMonth(d.getMonth() - months);
      return d.toISOString().split('T')[0];
    })();

    return {
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: `Run a comprehensive health check for ${siteUrl ? siteUrl : 'all verified sites'} on ${engine === 'google' ? 'Google' : 'GA4'} analyzing the period ${start} to ${end}.

Use the '${engine === 'google' ? 'sites_health_check' : 'analytics_user_behavior'}' tool.

Then for each site in the results:
1. **Summarize the status** (healthy / warning / critical).
2. **Performance:** Report changes in key metrics (clicks/impressions for search, sessions/engagement for GA4).
3. **Internal Health:** Note any errors or warnings (use '${engine === 'google' ? 'sitemaps_list' : 'analytics_conversion_funnel'}').
4. **Anomalies:** Highlight any traffic drops (use '${engine === 'google' ? 'analytics_anomalies' : 'analytics_realtime'}').

If any site has a 'critical' or 'warning' status:
- For critical drops, use '${engine === 'google' ? 'analytics_drop_attribution' : 'analytics_user_behavior'}'.
- Provide 3 prioritized action items.`
        }
      }]
    };
  }
);

registerPrompts(server);

// Diagnostics Tool
server.tool(
  "diagnostics",
  "Run connectivity diagnostics for all connected accounts. Use this to troubleshoot '0 results' or authentication issues.",
  {},
  async () => {
    try {
      const results = await runDiagnostics();
      return {
        content: [{ type: "text", text: JSON.stringify(results, null, 2) }]
      };
    } catch (error) {
      return formatError(error);
    }
  }
);

async function main() {
  const command = process.argv[2];

  // Handle standalone commands
  if (command === 'setup') {
    const { main: setupMain } = await import('./setup.js');
    await setupMain();
    return;
  }

  if (command === 'account' || command === 'accounts') {
    const { main: accountsMain } = await import('./accounts.js');
    await accountsMain(process.argv.slice(3));
    return;
  }

  if (command === 'logout') {
    const { runLogout } = await import('./setup.js');
    await runLogout();
    return;
  }

  if (command === 'login') {
    const { login } = await import('./setup.js');
    await login();
    return;
  }

  if (command === 'diagnostics') {
    const results = await runDiagnostics();
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  if (command === 'sites') {
    const { main: accountsMain } = await import('./accounts.js');
    await accountsMain(['list']);
    return;
  }

  // Check for credentials
  const config = await loadConfig();
  const accounts = Object.values(config.accounts);

  const hasGoogle = accounts.some(a => a.engine === 'google') ||
    !!process.env.GOOGLE_APPLICATION_CREDENTIALS ||
    (!!process.env.GOOGLE_CLIENT_EMAIL && !!process.env.GOOGLE_PRIVATE_KEY) ||
    existsSync(join(homedir(), '.google-seo-mcp-tokens.enc')); // Legacy check

  const hasGA4 = accounts.some(a => a.engine === 'ga4');

  if (!hasGoogle && !hasGA4) {
    printBoxHeader('Authentication', colors.red);

    console.error(`${colors.bold}${colors.dim}🔍 Connection Status:${colors.reset}`);
    printStatusLine('Google', hasGoogle);
    printStatusLine('GA4', hasGA4);
    console.error('');

    if (!hasGoogle) {
      console.error(`${colors.red}✘${colors.reset} ${colors.bold}Google not configured.${colors.reset}`);
      console.error(`${colors.blue}ℹ${colors.reset} ${colors.dim}Run:${colors.reset} ${colors.bold}${colors.cyan}google-seo-mcp setup --engine=google${colors.reset}`);
    }

    if (!hasGA4) {
      console.error(`${colors.red}✘${colors.reset} ${colors.bold}GA4 not configured.${colors.reset}`);
      console.error(`${colors.blue}ℹ${colors.reset} ${colors.dim}Run:${colors.reset} ${colors.bold}${colors.cyan}google-seo-mcp setup --engine=ga4${colors.reset}`);
    }

    console.error(`\n${colors.dim}${'─'.repeat(64)}${colors.reset}\n`);
  }

  const googleStatus = hasGoogle ? `${colors.green}✔ Google${colors.reset}` : `${colors.red}✘ Google${colors.reset}`;
  const ga4Status = hasGA4 ? `${colors.green}✔ GA4${colors.reset}` : `${colors.red}✘ GA4${colors.reset}`;

  if (command === 'sse') {
    const app = express();
    const port = parseInt(process.env.PORT || '3000', 10);
    
    // Normalize BASE_PATH
    let basePath = process.env.BASE_PATH || '';
    if (basePath && !basePath.startsWith('/')) {
      basePath = '/' + basePath;
    }
    if (basePath.endsWith('/')) {
      basePath = basePath.slice(0, -1);
    }

    // Shared API Key Authorization Middleware
    const authMiddleware = (req: express.Request, res: express.Response, next: express.NextFunction) => {
      const apiKey = process.env.MCP_API_KEY;
      if (!apiKey) {
        return next();
      }
      const authHeader = req.headers.authorization;
      if (!authHeader || authHeader !== `Bearer ${apiKey}`) {
        res.status(401).send("Unauthorized: Invalid or missing API key");
        return;
      }
      next();
    };

    app.use(express.json());

    const transports: Record<string, SSEServerTransport> = {};

    app.get(`${basePath}/sse`, authMiddleware, async (req, res) => {
      logger.info(`New SSE connection initiated. Base Path: ${basePath}`);
      const transport = new SSEServerTransport(`${basePath}/messages`, res);
      transports[transport.sessionId] = transport;

      res.on('close', () => {
        logger.info(`SSE connection closed for session: ${transport.sessionId}`);
        delete transports[transport.sessionId];
      });

      await server.connect(transport);
    });

    app.post(`${basePath}/messages`, authMiddleware, async (req, res) => {
      const sessionId = req.query.sessionId as string;
      const transport = transports[sessionId];

      if (transport) {
        await transport.handlePostMessage(req, res);
      } else {
        res.status(400).send('Session not found');
      }
    });

    app.get(`${basePath}/setup`, async (req, res) => {
      try {
        const clientId = process.env.GOOGLE_CLIENT_ID || DEFAULT_CLIENT_ID;
        const clientSecret = process.env.GOOGLE_CLIENT_SECRET || DEFAULT_CLIENT_SECRET;
        if (!clientId || !clientSecret) {
          throw new Error("Google OAuth credentials are not configured. Please set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables.");
        }
        
        const protocol = (req.headers['x-forwarded-proto'] as string) || req.protocol || 'http';
        const redirectUri = `${protocol}://${req.headers.host}${basePath}/oauth2callback`;
        
        const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
        
        const authUrl = oauth2Client.generateAuthUrl({
          access_type: 'offline',
          scope: [
            'https://www.googleapis.com/auth/webmasters.readonly',
            'https://www.googleapis.com/auth/userinfo.email',
            'https://www.googleapis.com/auth/analytics.readonly'
          ],
          prompt: 'consent'
        });
        
        res.redirect(authUrl);
      } catch (error: any) {
        res.status(500).send(`<h1>OAuth Initiation Failed</h1><p>${error.message}</p>`);
      }
    });
 
    app.get(`${basePath}/oauth2callback`, async (req, res) => {
      const code = req.query.code as string;
      if (!code) {
        res.status(400).send('Missing authorization code');
        return;
      }
      
      try {
        const clientId = process.env.GOOGLE_CLIENT_ID || DEFAULT_CLIENT_ID;
        const clientSecret = process.env.GOOGLE_CLIENT_SECRET || DEFAULT_CLIENT_SECRET;
        if (!clientId || !clientSecret) {
          throw new Error("Google OAuth credentials are not configured. Please set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables.");
        }
        const protocol = (req.headers['x-forwarded-proto'] as string) || req.protocol || 'http';
        const redirectUri = `${protocol}://${req.headers.host}${basePath}/oauth2callback`;
        
        const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
        const { tokens } = await oauth2Client.getToken(code);
        
        const email = await getUserEmail(tokens);
        const emailSlug = email.replace(/[^a-zA-Z0-9]/g, '_');
        
        // Save Search Console credentials
        const gscAccount: AccountConfig = {
          id: `google_${emailSlug}`,
          engine: 'google',
          alias: email,
          tokens: {
            refresh_token: tokens.refresh_token,
            expiry_date: tokens.expiry_date,
            access_token: tokens.access_token
          }
        };
        await updateAccount(gscAccount);
        
        // Save GA4 credentials (same tokens)
        const ga4Account: AccountConfig = {
          id: `ga4_${emailSlug}`,
          engine: 'ga4',
          alias: email,
          tokens: {
            refresh_token: tokens.refresh_token,
            expiry_date: tokens.expiry_date,
            access_token: tokens.access_token
          }
        };
        await updateAccount(ga4Account);
        
        res.send(`<h1>Authentication Successful!</h1><p>Account <strong>${email}</strong> has been successfully authorized for both Google Search Console and Google Analytics 4.</p>`);
      } catch (error: any) {
        res.status(500).send(`<h1>Authentication Failed</h1><p>${error.message}</p>`);
      }
    });

    app.listen(port, () => {
      console.error(`Google SEO MCP running on SSE at http://localhost:${port}${basePath} [ ${googleStatus} | ${ga4Status} ]`);
      if (process.env.MCP_API_KEY) {
        console.error(`Authorization: Enabled (Requires Bearer token matching MCP_API_KEY)`);
      } else {
        console.error(`Authorization: Disabled (MCP_API_KEY not configured)`);
      }
    });
  } else {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error(`Google SEO MCP running on stdio [ ${googleStatus} | ${ga4Status} ]`);
  }
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
