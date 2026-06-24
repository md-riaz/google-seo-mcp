import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock googleapis before importing anything that uses it
vi.mock('googleapis', () => ({
    searchconsole_v1: {},
    google: {
        searchconsole: vi.fn().mockReturnValue({})
    }
}));

// Mock node-machine-id
vi.mock('node-machine-id', () => ({
    default: {
        machineIdSync: vi.fn().mockReturnValue('mock-machine-id')
    }
}));

import { mockSearchConsoleClient } from './mocks';

// Re-mock src/google/client here to ensure it applies
vi.mock('../src/google/client', () => ({
  getSearchConsoleClient: vi.fn().mockResolvedValue(mockSearchConsoleClient),
}));

import { inspectBatch as inspectBatchGoogle } from '../src/google/tools/inspection';

describe('Batch Inspection Tool', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('Google Batch Inspection', () => {
        it('should process multiple URLs in batch', async () => {
            const siteUrl = 'https://example.com';
            const urls = ['https://example.com/page1', 'https://example.com/page2', 'https://example.com/page3'];

            mockSearchConsoleClient.urlInspection.index.inspect.mockImplementation(async ({ requestBody }) => {
                return {
                    data: {
                        inspectionResult: {
                            indexStatusResult: {
                                verdict: 'PASS',
                                inspectionUrl: requestBody.inspectionUrl
                            }
                        }
                    }
                };
            });

            const results = await inspectBatchGoogle(siteUrl, urls);

            expect(results).toHaveLength(3);
            expect(mockSearchConsoleClient.urlInspection.index.inspect).toHaveBeenCalledTimes(3);
            expect(results[0].url).toBe(urls[0]);
            expect(results[0].result?.inspectionResult?.indexStatusResult?.verdict).toBe('PASS');
        });

        it('should handle errors for individual URLs', async () => {
            const siteUrl = 'https://example.com';
            const urls = ['https://example.com/page1', 'https://example.com/error'];

            mockSearchConsoleClient.urlInspection.index.inspect.mockImplementation(async ({ requestBody }) => {
                if (requestBody.inspectionUrl.includes('error')) {
                    throw new Error('API Error');
                }
                return { data: { result: 'ok' } };
            });

            const results = await inspectBatchGoogle(siteUrl, urls);

            expect(results).toHaveLength(2);
            expect(results[0].result).toBeDefined();
            expect(results[1].error).toBe('API Error');
        });
    });
});
