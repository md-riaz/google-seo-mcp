import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getStartedHandler } from '../src/common/tools/get-started.js';
import * as fs from 'fs';
import * as os from 'os';

vi.mock('fs');
vi.mock('os');

describe('get_started tool', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    // Default mocks
    (fs.existsSync as any).mockReturnValue(false);
    (os.homedir as any).mockReturnValue('/tmp');
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.clearAllMocks();
  });

  it('should include Google tools when Google is enabled via env', async () => {
    process.env.GOOGLE_APPLICATION_CREDENTIALS = 'fake-path.json';

    const result = await getStartedHandler();
    const content = JSON.parse(result.content[0].text);

    expect(content.active_platforms).toHaveProperty('google');

    const intentGroups = content.intent_groups;
    const trafficGroup = intentGroups.find((g: any) => g.name === 'Diagnose Traffic Problems');
    expect(trafficGroup).toBeDefined();
    expect(trafficGroup.tools.some((t: any) => t.name === 'analytics_anomalies')).toBe(true);
  });

  it('should handle neither-platform-enabled scenario', async () => {
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    delete process.env.GOOGLE_CLIENT_EMAIL;
    delete process.env.GOOGLE_PRIVATE_KEY;
    delete process.env.BING_API_KEY;

    const result = await getStartedHandler();
    const content = JSON.parse(result.content[0].text);

    expect(content.active_platforms).toEqual({});
    // Should still have a server summary and basic structure
    expect(content.server_summary).toBeDefined();
    expect(content.recommended_starting_points).toBeDefined();
  });
});
