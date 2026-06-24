import { loadConfig, AccountConfig } from '../../common/auth/config.js';
import { loadTokensForAccount, saveTokensForAccount, DEFAULT_CLIENT_ID, DEFAULT_CLIENT_SECRET } from '../../google/client.js';
import { google } from 'googleapis';
import { logger } from '../../utils/logger.js';

/**
 * List configured and dynamic GA4 properties.
 */
export async function listProperties(accountId?: string) {
    const config = await loadConfig();
    let accounts = Object.values(config.accounts).filter(a => a.engine === 'ga4');

    if (accountId) {
        accounts = accounts.filter(a => a.id === accountId);
        if (accounts.length === 0) {
            throw new Error(`GA4 account ${accountId} not found.`);
        }
    }

    const allProperties: any[] = [];

    for (const account of accounts) {
        let fetchedDynamic = false;

        // Skip service account for dynamic listing (OAuth only)
        if (!account.serviceAccountPath) {
            try {
                const tokens = await loadTokensForAccount(account);
                if (tokens) {
                    const clientId = process.env.GOOGLE_CLIENT_ID || DEFAULT_CLIENT_ID;
                    const clientSecret = process.env.GOOGLE_CLIENT_SECRET || DEFAULT_CLIENT_SECRET;
                    if (!clientId || !clientSecret) {
                        throw new Error("Google OAuth credentials are not configured. Please set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables.");
                    }
                    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
                    oauth2Client.setCredentials(tokens);

                    if (tokens.expiry_date && tokens.expiry_date <= Date.now()) {
                        const { credentials } = await oauth2Client.refreshAccessToken();
                        await saveTokensForAccount(account, credentials);
                        oauth2Client.setCredentials(credentials);
                    }

                    const admin = google.analyticsadmin({ version: 'v1alpha', auth: oauth2Client });
                    const accountsRes = await admin.accounts.list();
                    const gaAccounts = accountsRes.data.accounts || [];

                    for (const gaAccount of gaAccounts) {
                        if (!gaAccount.name) continue;
                        
                        const propertiesRes = await admin.properties.list({
                            filter: `parent:${gaAccount.name}`
                        });
                        
                        const properties = propertiesRes.data.properties || [];
                        for (const prop of properties) {
                            if (!prop.name) continue;
                            const propertyId = prop.name.split('/')[1];
                            allProperties.push({
                                id: account.id,
                                alias: account.alias,
                                propertyId: propertyId,
                                siteUrl: propertyId,
                                displayName: prop.displayName || '',
                                gaAccountName: gaAccount.displayName || ''
                            });
                            fetchedDynamic = true;
                        }
                    }
                }
            } catch (error: any) {
                logger.error(`Failed to dynamically list properties for account ${account.alias}:`, error.message);
            }
        }

        // Fallback to configured property ID if dynamic listing didn't find anything or for service accounts
        if (!fetchedDynamic && account.ga4PropertyId) {
            allProperties.push({
                id: account.id,
                alias: account.alias,
                propertyId: account.ga4PropertyId,
                siteUrl: account.ga4PropertyId
            });
        }
    }

    return allProperties;
}
