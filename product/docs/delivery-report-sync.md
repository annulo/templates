# Customer website report sync

Annulo collects Google Search Console and AI visibility observations. The customer's Creght delivery console stores immutable report snapshots and presents them under `/website-performance`; `/page-tracking` keeps the technical checks and operator workflow. There is no second Google OAuth connection in the console.

## Collection and destination

Only `creght_site` channels with `project_id` and `site_id` export reports. `_delivery_reports.ts` uses the existing region-specific Creght MCP (`creght`, `creght-cn`, `creght-com`), asks `site_status` for `report_url` (the console's primary origin), and calls `site_report_sync` with the collected report. Platform authentication requires site:write plus actual project/site write permission. Arbitrary URL channels and WordPress do not have a delivery export target.

- `gsc.sync`: exports the finalized 28-day search window, per-day metrics, URL metrics and up to 100 query summaries. Totals come from a separate query without dimensions; they are never summed from the potentially truncated URL rows. All collection queries use an escaped, anchored page-origin filter, so a domain property cannot mix sibling sites into a customer's totals. The existing Annulo data continues to be stored locally.
- `_audit_index.indexChecks`: exports persisted URL Inspection records, including each URL's actual inspection date, Google coverage state, canonical and crawl date. Search impressions do not become new URL Inspection results. Fresh cached records remain dated as originally inspected.
- `geo.check`: exports successful sampled answers after each engine run, keeping recommendation and brand questions distinct. Includes engine/model, question, answer excerpt and same-origin cited URLs; no invented conversation link, region or language. Latest retry answer for a question supersedes older answers within that run. A partial report records failure count and truncation.

Google access/refresh tokens, OAuth client credentials, account emails, private operator notes, provider settings and complete AI transcripts are not in this export contract. The platform also decodes a typed allowlist and validates bound domains, source kind, dates, metrics, URL schemes and payload sizes. A report is a collector-provided observation, not a Google-signed attestation.

## Durable delivery

`delivery_sync` stores one latest snapshot per channel/report-kind/AI-engine. Enqueue assigns a stable report ID and binds the target project/site/region. A lost acknowledgement retries the same ID and body. The receiving platform appends once under a transaction lock; reusing an ID with different content is rejected. An old report arriving later cannot replace a newer one because the console orders by collection time.

Successful collection immediately tries delivery. `deliverysync.sync` retries pending or failed uploads without repeating Google calls or AI questions; `schedules/deliverysync.sync.json` retries hourly while Annulo runs. Channel rebinding requires fresh collection. Google unlink pauses pending Google deliveries. Failed uploads retain the local report and display status/retry under Data connections. The console shows the last saved report, so it remains readable while Annulo is offline. Refresh in the console does not start a new scan.

The platform and console release must precede template rollout. `site_status.report_url` and `site_report_sync` require the platform revision recorded in weave's report-sync release handoff. No new Annulo binary, API level, secret or customer table setup is required. Existing projects get the new local table/schedule through their normal template upgrade; users choose when to upgrade.

## Limits and semantics

A report carries at most 1,000 URLs/inspection rows, 180 daily rows, 100 query summaries, 10 queries per URL, or 100 AI answer samples; body is capped at 900 KB by the receiver. Exceeding a source sample/row cap is disclosed as partial. Missing report rows mean unknown, not zero traffic or unindexed. AI counts describe this sample, not platform-wide coverage. Customer issue states and notes stay in the delivery console and are never overwritten by reports. Failed remote writes are retried; an interrupted first collection must be collected again if its source payload was never saved to the outbox.

Tests: `node --test publish/tests/delivery-sync.test.mjs publish/tests/audit.test.mjs`; typecheck `npm run check creator product trade`. The tests use isolated local adapters and never write customer production data. Full Google/AI account collection and mounted production acceptance remain deployment-time checks.
