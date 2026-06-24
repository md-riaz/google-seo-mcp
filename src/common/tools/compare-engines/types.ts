export type Engine = "google";

export interface NormalizedRow {
  key: string; // query/page/device/country value
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
  engine: Engine;
}

export interface EngineStats {
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface GA4Stats {
    sessions: number;
    bounceRate: number;
    engagementRate: number;
    averageSessionDuration: number;
    conversions: number;
    activeUsers?: number;
    eventCount?: number;
    revenue?: number;
}

export interface PageAnalysisRow {
    url: string;
    gsc?: EngineStats;
    ga4?: GA4Stats;
    clickToSessionRatio?: number;
    opportunityScore?: number;
}

export interface TrafficHealthRow {
    date: string;
    gscClicks: number;
    ga4OrganicSessions: number;
    ratio: number;
    classification: 'Healthy' | 'Tracking Gap' | 'Filter Issue';
    recommendation: string;
}

export interface OpportunityMatrixRow {
    url: string;
    query?: string;
    gsc: EngineStats;
    ga4?: GA4Stats;
    priorityScore: number;
    action: string;
    category: 'Quick Win' | 'Content Fix';
}

export interface BrandAnalysisRow {
    platform: 'Google' | 'GA4';
    brandMetrics: {
        clicks?: number;
        impressions?: number;
        sessions?: number;
    };
    nonBrandMetrics: {
        clicks?: number;
        impressions?: number;
        sessions?: number;
    };
    brandShare: number;
}
