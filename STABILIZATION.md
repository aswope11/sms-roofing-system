# SMS Roofing — Stabilization

This branch is the safe repair lane for the production system.

## Production guardrails
- Do not merge to `main` until the stabilization changes have been reviewed and tested.
- Do not alter production business data as part of code cleanup.
- Preserve the existing roofing/business rules covered by the test suite.
- Preserve QuickBooks and Gmail OAuth token stores.
- Preserve Netlify Database migrations and production backup/restore capability.
- Replace the optional Anthropic/Claude dependency rather than reconnecting it blindly.

## Verified architecture
- Netlify production deploys from GitHub `main`.
- Business records use Netlify Database.
- Job files use Netlify Blobs.
- QuickBooks tokens use the `qbo` Blob store.
- Gmail tokens use the `gmail` Blob store.
- The Gmail label worker runs every 15 minutes.
- Claude-dependent paths currently fail/skip safely when `ANTHROPIC_API_KEY` is absent.

## Stabilization order
1. Keep production isolated.
2. Protect existing business-rule tests.
3. Make integrations report failures clearly instead of failing silently.
4. Remove/replace Claude-specific assumptions.
5. Reduce risk in the oversized backend without changing business behavior.
6. Test the branch before any production merge.
