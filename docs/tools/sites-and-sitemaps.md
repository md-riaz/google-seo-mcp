---
title: "Discovery Tools"
description: "Managing sites and discovery paths."
---

Sitemaps are how you tell Google what to crawl. Our sitemap tools give the agent control over how your site is discovered.

## Tool Groups

### Site Management
*   `list_sites`: See everything in your account.
*   `add_site`: Add a new property.
*   `delete_site`: Remove a property.

### Sitemap Management
*   `list_sitemaps`: See status and error counts.
*   `submit_sitemap`: Push a new XML sitemap to the engine.

## Operational Use Cases

### 1. New Site Onboarding
An agent can automatically list all your properties and run an initial "health check" on each one.

### 2. Monitoring Errors
An agent can periodically check `list_sitemaps` to see if Google has reported any "Couldn't fetch" or "Parsing error" statuses.

## Example Agent Prompts

#### 1. Checking Sitemap Health
> "Check the status of all sitemaps for https://example.com. Are there any errors or warnings I should know about?"

#### 2. Discovery Audit
> "When was the last time the sitemap for https://example.com was crawled? Find any pages that are in the sitemap but not getting indexed."

#### 3. New Content Deployment
> "I just added a new sitemap at https://example.com/products-sitemap.xml. Please submit it to Search Console."
