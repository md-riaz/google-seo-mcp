import { describe, it, expect, vi, beforeEach } from 'vitest';
import { analyzePagesCrossPlatform } from '../../src/common/tools/compare-engines/ga4-gsc-comparator.js';
import * as gscAnalytics from '../../src/google/tools/analytics.js';
import * as ga4Analytics from '../../src/ga4/tools/analytics.js';

vi.mock('../../src/google/tools/analytics.js');
vi.mock('../../src/ga4/tools/analytics.js');

describe('analyzePagesCrossPlatform (Opportunity Matrix)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should identify opportunities and prioritize correctly', async () => {
        // GSC: Pos 12, High Impressions
        vi.mocked(gscAnalytics.queryAnalytics).mockResolvedValue([
            { keys: ['https://example.com/page1'], clicks: 10, impressions: 2000, ctr: 0.005, position: 12 }
        ] as any);

        // GA4: High Engagement
        vi.mocked(ga4Analytics.getOrganicLandingPages).mockResolvedValue([
            { landingPagePlusQueryString: '/page1', sessions: 100, engagementRate: 0.8, bounceRate: 0.1 }
        ] as any);

        const results = await analyzePagesCrossPlatform('https://example.com', '123', 'start', 'end');

        expect(results).toHaveLength(1);
        expect(results[0].opportunityScore).toBeGreaterThan(0);
    });

    it('should handle missing GA4 data gracefully', async () => {
        vi.mocked(gscAnalytics.queryAnalytics).mockResolvedValue([
            { keys: ['https://example.com/page1'], clicks: 10, impressions: 100 }
        ] as any);
        vi.mocked(ga4Analytics.getOrganicLandingPages).mockResolvedValue([] as any);

        const results = await analyzePagesCrossPlatform('https://example.com', '123', 'start', 'end');

        expect(results).toHaveLength(1);
        expect(results[0].opportunityScore).toBeDefined();
    });
});
