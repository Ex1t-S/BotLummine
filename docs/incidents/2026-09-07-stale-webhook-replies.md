# Incident: automatic replies to delayed Meta webhook messages

## Evidence and containment

- After webhook delivery recovered, inbound messages with old Meta timestamps were stored with the current ingestion time and entered automatic reply routes.
- Initial aggregate audit since 2026-09-06 21:24:34 UTC: 167 inbound records, 116 delayed by over 15 minutes, across 56 conversations; maximum observed delay about 127 hours.
- 45 system/fallback replies in 24 conversations occurred within two minutes after delayed inbound records. This temporal association is not a claim that every delayed inbound received a reply.
- At approximately 2026-09-07 17:14:59 UTC, Lummine's `whatsapp_outbound`, `ai_auto_replies`, `campaign_dispatch` and `automation_dispatch` flags were disabled. This also temporarily blocks manual outbound messages.
- No outbound records were observed after 17:15 UTC during the initial verification. There were no pending auto-reply entries at the subsequent check.

## Remediation

- Preserve valid Meta event timestamps when recording new inbound history.
- Suppress automatic processing of Meta messages older than 15 minutes, or with missing/invalid/future timestamps. This includes deferred reply processing.
- Check the auto-reply pause before menus, cart reply routing, payment acknowledgements or model calls, rather than only before the language-model branch.
- Match deduplication to the existing database uniqueness constraint `(workspaceId, metaMessageId)`; persist the channel on new records and handle concurrent duplicate insert conflicts.
- Advance conversation timestamps conditionally so delayed messages do not overwrite a more recent timestamp.
- Keep receipt/status webhook ingestion working. No message history is deleted, no schema migration is needed, and no customer messages are sent as part of testing.

## Verification and recovery

- Unit tests cover freshness boundaries, malformed/future timestamps, legacy null-channel duplicates, simultaneous retries, persistence failures, and workspace-scoped monotonic timestamp updates.
- Routing regression tests exercise the real inbound processor with a fake database: both stale retries and paused current messages must exit before automatic routing, including resumed pending replies.
- Keep emergency flags disabled after deployment. Reactivate only following a controlled test with an internal number and review of campaign queues; do not replay historical inbound messages to customers.
- Already delivered WhatsApp messages cannot be undone by deleting database records. Preserve the audit trail.
