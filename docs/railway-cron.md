# Railway cron jobs

Use Railway cron services for background work while customer volume is still moderate. Each cron service should use this same repository, inherit the production environment variables, run one command, and exit when the command completes.

Railway schedules cron jobs in UTC. Keep the web service as the persistent API process and create separate cron services for jobs.

## Services

| Service | Start command | Cron schedule | Purpose |
| --- | --- | --- | --- |
| Web | `npm start` | none | API, webhooks, dashboard, inbox |
| Campaign dispatch | `npm run jobs:campaign-dispatch` | `*/5 * * * *` | Creates due scheduled campaigns and sends queued campaign recipients |
| Enbox sync | `npm run jobs:enbox-sync` | `*/30 * * * *` | Syncs shipment state incrementally |
| Diagnose | `npm run jobs:diagnose` | `0 */6 * * *` | Optional operational smoke check |

## Railway setup

1. Keep the existing web service using `npm start` and `/api/health`.
2. Create a new Railway service from the same GitHub repo for `Campaign dispatch`.
3. Set its start command to `npm run jobs:campaign-dispatch`.
4. Set its Cron Schedule to `*/5 * * * *`.
5. Remove any HTTP healthcheck from this cron service.
6. Repeat the same pattern for `Enbox sync` with `npm run jobs:enbox-sync` and `*/30 * * * *`.
7. Optionally add `Diagnose` with `npm run jobs:diagnose` and `0 */6 * * *`.

## Runtime expectations

- Cron services must finish and exit. The current job entrypoints disconnect Prisma in `finally`, so Railway can schedule the next run.
- If a previous run is still active, Railway skips the next scheduled execution. Treat skipped runs as a signal to reduce batch size, increase spacing, or move to a persistent worker.
- Campaign dispatch already uses database locks to avoid duplicate sends across overlapping executions.
- Use `CAMPAIGN_DISPATCH_BATCH_SIZE`, `CAMPAIGN_SEND_DELAY_MS`, and `CAMPAIGN_DISPATCH_LOCK_MS` to tune throughput before adding Redis or BullMQ.

## When to upgrade

Move from cron to a persistent worker when campaigns regularly wait more than one cron interval, jobs are still active when the next run starts, or API/webhook latency increases because background work is competing for resources.

Add Redis or BullMQ only when the app needs per-message retry policies, priorities, multiple worker pools, or higher-volume parallel dispatch.
