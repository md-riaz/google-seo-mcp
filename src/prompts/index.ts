import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getEnabledPlatforms } from "../common/platforms.js";

/**
 * Helper to build a numbered step list. Automatically increments
 * the step counter so optional/conditional steps don't break numbering.
 */
class StepBuilder {
    private steps: string[] = [];
    private counter = 1;

    add(text: string): void {
        this.steps.push(`${this.counter}. ${text}`);
        this.counter++;
    }

    /** Add a final synthesis instruction (unnumbered). */
    synthesize(text: string): void {
        this.steps.push(`\nFinally: ${text}`);
    }

    toString(): string {
        return this.steps.join("\n");
    }

    get length(): number {
        return this.steps.length;
    }
}

/**
 * Escape user-supplied brand terms for safe interpolation into regex strings.
 * Strips characters that could break regex parsing.
 */
function sanitizeBrandTerms(terms: string): string {
    // Split on commas, trim, remove any regex-special chars except alphanumeric/space/hyphen
    return terms
        .split(",")
        .map(t => t.trim().replace(/[^a-zA-Z0-9\s\-]/g, ""))
        .filter(Boolean)
        .join("|");
}

export function registerPrompts(server: McpServer) {

    // ────────────────────────────────────────────────────────────────
    // 1. Investigate Traffic Drop
    // ────────────────────────────────────────────────────────────────
    server.prompt(
        "investigate_traffic_drop",
        {
            site_url: z.string().optional().describe("The URL of the site (optional, defaults to env/context)"),
            period: z.string().optional().describe("Period to analyze (default: 'last 28 days')")
        },
        ({ site_url, period = "last 28 days" }) => {
            const { isGoogleEnabled, isGA4Enabled } = getEnabledPlatforms();
            const steps = new StepBuilder();

            if (isGoogleEnabled) {
                steps.add("Run 'analytics_anomalies' to confirm a drop exists and find the exact date it started.");
                steps.add("Run 'analytics_time_series' to visualize the trend and check for seasonality.");
                steps.add("Run 'analytics_drop_attribution' to identify whether the loss is concentrated on mobile or desktop.");
                steps.add("Fetch the top affected pages by comparing two date ranges around the drop date (use 'analytics_compare_periods').");
                steps.add("For the top 3 affected pages, run 'inspection_inspect' to check indexing status.");
            }
            if (isGA4Enabled) {
                steps.add("Run 'analytics_realtime' to see if current traffic is flowing.");
                steps.add("Run 'analytics_user_behavior' to check if the drop is specific to a country or device category.");
                if (isGoogleEnabled) {
                    steps.add("Run 'traffic_health_check' to compare GSC clicks vs GA4 organic sessions (diagnose tracking issues).");
                }
            }
            steps.synthesize("Synthesize findings into: when it started, what pages/devices are affected, likely cause, and 3 recommended actions.");

            return {
                messages: [{
                    role: "user",
                    content: {
                        type: "text",
                        text: `Investigate a traffic drop for ${site_url || "the active site"} over the ${period}.\n\nWorkflow:\n${steps}`
                    }
                }]
            };
        }
    );

    // ────────────────────────────────────────────────────────────────
    // 2. Find Quick Wins
    // ────────────────────────────────────────────────────────────────
    server.prompt(
        "find_quick_wins",
        {
            site_url: z.string().optional().describe("The URL of the site"),
            min_impressions: z.number().optional().describe("Minimum impressions threshold (default: 1000)"),
            date_range: z.string().optional().describe("Date range to analyze (default: 'last 90 days')")
        },
        ({ site_url, min_impressions = 1000, date_range = "last 90 days" }) => {
            const { isGoogleEnabled, isGA4Enabled } = getEnabledPlatforms();
            const steps = new StepBuilder();

            if (isGoogleEnabled) {
                steps.add(`Run 'seo_striking_distance' with minImpressions=${min_impressions} to get candidates in positions 8-15.`);
                steps.add(`Run 'seo_low_hanging_fruit' with minImpressions=${min_impressions} to get candidates in positions 5-20.`);
                steps.add("For the top 5 candidates, run 'pagespeed_analyze' to check performance.");
            }
            if (isGA4Enabled && isGoogleEnabled) {
                steps.add("Run 'page_analysis' to find pages with good GSC potential but poor GA4 engagement.");
                steps.add("Run 'analytics_pagespeed_correlation' to see if speed improvements would boost engagement on top pages.");
            }
            steps.synthesize("Output a ranked action list: page URL, current position, impressions, what to fix, expected impact.");

            return {
                messages: [{
                    role: "user",
                    content: {
                        type: "text",
                        text: `Find quick win SEO opportunities for ${site_url || "the active site"} (${date_range}, minimum ${min_impressions} impressions).\n\nWorkflow:\n${steps}`
                    }
                }]
            };
        }
    );

    // ────────────────────────────────────────────────────────────────
    // 3. Full Site Audit
    // ────────────────────────────────────────────────────────────────
    server.prompt(
        "full_site_audit",
        {
            site_url: z.string().optional().describe("The URL of the site"),
            brand_terms: z.string().optional().describe("Comma-separated brand terms (e.g. 'nike,air max')"),
            date_range: z.string().optional().describe("Date range to analyze (default: 'last 90 days')")
        },
        ({ site_url, brand_terms, date_range = "last 90 days" }) => {
            const { isGoogleEnabled, isGA4Enabled } = getEnabledPlatforms();
            const steps = new StepBuilder();

            if (isGoogleEnabled) {
                steps.add("Run 'sites_list' to confirm the property is accessible.");
                if (brand_terms) {
                    const sanitized = sanitizeBrandTerms(brand_terms);
                    steps.add(`Run 'seo_brand_vs_nonbrand' with regex '(${sanitized})' to see the brand vs non-brand split.`);
                }
                steps.add("Run 'seo_cannibalization' to flag any competing pages.");
                steps.add("Run 'seo_lost_queries' to flag any queries that dropped to zero traffic.");
                steps.add("Run 'seo_low_ctr_opportunities' to find pages ranking well but not getting clicked.");
                steps.add("List all sitemaps ('sitemaps_list') and flag any with errors.");
            }
            if (isGA4Enabled) {
                steps.add("Run 'analytics_user_behavior' to get an overview of audience health.");
                steps.add("Run 'analytics_traffic_sources' to check the mix of traffic (Organic vs Direct/Social).");
                steps.add("Run 'analytics_conversion_funnel' to flag any drops in user conversion.");
                if (isGoogleEnabled) {
                    steps.add("Run 'opportunity_matrix' to get a prioritized list of tasks across platforms.");
                }
            }
            steps.synthesize("Synthesize into an executive summary: overall health score, top 3 wins, top 3 risks, recommended priority order.");

            return {
                messages: [{
                    role: "user",
                    content: {
                        type: "text",
                        text: `Perform a full site audit for ${site_url || "the active site"} (${date_range}).\n\nWorkflow:\n${steps}`
                    }
                }]
            };
        }
    );

    // ────────────────────────────────────────────────────────────────
    // 4. Analyze Page
    // ────────────────────────────────────────────────────────────────
    server.prompt(
        "analyze_page",
        {
            page_url: z.string().describe("The page URL to analyze"),
            date_range: z.string().optional().describe("Date range to analyze (default: 'last 28 days')")
        },
        ({ page_url, date_range = "last 28 days" }) => {
            const { isGoogleEnabled, isGA4Enabled } = getEnabledPlatforms();
            const steps = new StepBuilder();

            if (isGoogleEnabled) {
                steps.add("Run 'inspection_inspect' for indexing status and mobile usability.");
                steps.add("Run 'analytics_query' filtered to this page (and query dimension) for clicks, impressions, CTR, position.");
                steps.add("Run 'analytics_trends' for this page to see if it is rising or falling.");
                steps.add("Run 'pagespeed_analyze' for performance audit.");
                steps.add("Run 'schema_validate' to check structured data.");
            }
            if (isGA4Enabled) {
                steps.add("Run 'analytics_page_performance' for this specific page path to see engagement and session metrics.");
            }
            steps.synthesize("Is this page healthy? What is its biggest limiting factor right now (rankings, CTR, speed, or indexing)?");

            return {
                messages: [{
                    role: "user",
                    content: {
                        type: "text",
                        text: `Deep-dive analysis for page: ${page_url} (${date_range}).\n\nWorkflow:\n${steps}`
                    }
                }]
            };
        }
    );

    // ────────────────────────────────────────────────────────────────
    // 5. Content Opportunity Report
    // ────────────────────────────────────────────────────────────────
    server.prompt(
        "content_opportunity_report",
        {
            site_url: z.string().optional().describe("The URL of the site"),
            date_range: z.string().optional().describe("Date range (default: 'last 90 days')")
        },
        ({ site_url, date_range = "last 90 days" }) => {
            const { isGoogleEnabled, isGA4Enabled } = getEnabledPlatforms();
            const steps = new StepBuilder();

            if (isGoogleEnabled) {
                steps.add("Run 'seo_low_ctr_opportunities' — good rankings but poor CTR means the title/meta needs work.");
                steps.add("Run 'seo_cannibalization' — check if competing pages dilute authority.");
                steps.add("Run 'seo_lost_queries' — topics you used to rank for but no longer do represent content decay.");
            }
            if (isGA4Enabled) {
                steps.add("Run 'analytics_content_performance' to identify content groups that are over or under-performing in engagement.");
            }
            steps.synthesize('Synthesize into three buckets: "optimize existing" (low CTR fixes), "consolidate" (cannibalization fixes), "revive or create" (lost queries + content gaps).');

            return {
                messages: [{
                    role: "user",
                    content: {
                        type: "text",
                        text: `Generate a content opportunity report for ${site_url || "the active site"} (${date_range}).\n\nWorkflow:\n${steps}`
                    }
                }]
            };
        }
    );

    // ────────────────────────────────────────────────────────────────
    // 6. Executive Summary
    // ────────────────────────────────────────────────────────────────
    server.prompt(
        "executive_summary",
        {
            site_url: z.string().optional().describe("The URL of the site"),
            brand_terms: z.string().optional().describe("Brand terms for segmentation (e.g. 'nike,air max')"),
            date_range: z.string().optional().describe("Date range (default: 'last 28 days')"),
            compare_to: z.string().optional().describe("Comparison period (default: 'previous period')")
        },
        ({ site_url, brand_terms, date_range = "last 28 days", compare_to = "previous period" }) => {
            const { isGoogleEnabled, isGA4Enabled } = getEnabledPlatforms();
            const steps = new StepBuilder();

            if (isGoogleEnabled) {
                steps.add(`Run 'analytics_compare_periods' (current ${date_range} vs ${compare_to}) to get the top-level trend.`);
                if (brand_terms) {
                    const sanitized = sanitizeBrandTerms(brand_terms);
                    steps.add(`Run 'seo_brand_vs_nonbrand' with regex '(${sanitized})' — brand-heavy traffic is a risk indicator.`);
                }
                steps.add("Run 'analytics_anomalies' to surface any spikes or drops worth flagging.");
            }
            if (isGA4Enabled) {
                steps.add("Run 'analytics_user_behavior' to check engagement metrics (engagement rate, sessions per user) compared to baseline.");
                steps.add("Run 'analytics_traffic_sources' to flag any significant shifts in acquisition channels.");
            }
            steps.synthesize("Synthesize into: one-paragraph performance narrative, three bullet wins, three bullet risks, five recommended actions ranked by impact, one key metric to watch next month.");

            return {
                messages: [{
                    role: "user",
                    content: {
                        type: "text",
                        text: `Generate an executive SEO summary for ${site_url || "the active site"} (${date_range}, compared to ${compare_to}).\n\nWorkflow:\n${steps}`
                    }
                }]
            };
        }
    );

    // ────────────────────────────────────────────────────────────────
    // 7. GA4 Acquisition & Conversion
    // ────────────────────────────────────────────────────────────────
    server.prompt(
        "ga4_traffic_audit",
        {
            property_id: z.string().describe("GA4 Property ID"),
            date_range: z.string().optional().describe("Date range (default: 'last 28 days')")
        },
        ({ property_id, date_range = "last 28 days" }) => {
            const steps = new StepBuilder();
            steps.add("Run 'analytics_traffic_sources' to identify top acquisition channels.");
            steps.add("Run 'analytics_organic_landing_pages' to see which pages are driving organic traffic.");
            steps.add("Run 'analytics_conversion_funnel' to see if top traffic sources are converting.");
            steps.add("Run 'analytics_user_behavior' to check engagement quality across devices.");
            steps.synthesize("Which traffic channel is most valuable, where is the highest drop-off in the funnel, and 3 recommendations to improve ROI.");

            return {
                messages: [{
                    role: "user",
                    content: {
                        type: "text",
                        text: `Perform a GA4 traffic and acquisition audit for property ${property_id} (${date_range}).\n\nWorkflow:\n${steps}`
                    }
                }]
            };
        }
    );
}
