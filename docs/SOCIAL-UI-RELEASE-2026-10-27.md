# Social interface release — 2026-10-27

This change unifies Discover, creator profiles, private/group conversations, UID cards, friends, paid-photo states, publishing, profile editing and orders. It preserves the existing contract, service, wallet adapter, transaction guard, storage and payment implementation.

## Production build

```
node scripts/build-app.mjs --api https://snapvault-api-production.up.railway.app --allow-mainnet
```

Only the resulting `dist/wallet` is eligible for DeWEB. It excludes demo identities, seeded people, sample purchase functionality and demo explanatory copy. The local `web/` development preview remains available separately. The production API, chain 196, existing vault and exact original site Origin have been checked read-only. Real signed user actions on production have not been performed for this release.

## Validation and release boundary

Run `node scripts/test-all.mjs` with Chrome available, then `node scripts/social-release.spec.mjs`. These use isolated chains, test wallets and intercepted API fixtures; they must not be reported as new production purchase/withdrawal evidence. The new UI tests follow the independent profile and orders dialogs, explicit message timers, and current paid-card states. The retired publisher remains disabled in every pending-hash state.

The reviewed build is frozen with `node scripts/freeze-release.mjs`. `node scripts/quote-social-ui.mjs` verifies both RPC chain/implementation identities, checks reusable DeWEB files, and models fresh-storage gas for each changed chunk. The quote is an estimate, not an invoice or guaranteed maximum. Re-estimate each transaction immediately before signing; gas may change. The quote does not authorize spending.

Existing DeWEB site: https://10-2-6.tapekit.org/ . Compatibility site: https://10-2-6-open.tapekit.org/ . Existing container, contract and service are retained. No new container or contract is required for this UI update.

Do not remove the spending pause, reuse an old approval or restart the retired publisher. The deployment remains pending a specific new budget approval and user wallet confirmation. Source synchronization to GitHub does not publish DeWEB or trigger paid actions.

## Update workflow

Group related edits into a checked commit, review a preview, then release that commit. Tiny local edits do not each require a GitHub push or on-chain upload. Keep the previous frozen bundle for recovery. A GitHub rollback by itself does not roll back the on-chain site; restoring changed DeWEB files is a separate wallet-signed upload that also needs gas.
