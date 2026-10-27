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

Do not remove the spending pause, reuse an old approval or restart the retired publisher. For this frozen release, the user explicitly approved a 0.0012 OKB maximum and individually confirmed all eleven upload transactions in the wallet. Source synchronization to GitHub does not publish DeWEB or trigger paid actions.

## Update workflow

Group related edits into a checked commit, review a preview, then release that commit. Tiny local edits do not each require a GitHub push or on-chain upload. Keep the previous frozen bundle for recovery. A GitHub rollback by itself does not roll back the on-chain site; restoring changed DeWEB files is a separate wallet-signed upload that also needs gas.

Final validation: the full `test-all.mjs` suite and `social-release.spec.mjs` passed. Wallet UI integration includes 23 checks against the isolated local chain, including signed login, cross-browser images, payment/decryption, group timers and withdrawal. See `deployment/social-ui-validation.json`. The eleven mainnet uploads are now complete; each was confirmed by the user in their wallet. Actual fees total 0.000781789939089495 OKB, leaving 0.000418210060910505 OKB of the approved cap unused. Both independent RPCs verified every byte of all 24 frozen files and reconciled each successful receipt. See `deployment/social-ui-published-proof.json`.

## Production verification

Both the original and compatibility DeWEB sites loaded the new UI and real service data after upload. Desktop (1440 × 900) and mobile (390 × 844) checks covered messages, UID/account cards and publishing. Navigation and signed-out states worked, no horizontal overflow or demo identity/copy was observed, and neither site reported browser console errors. Screenshots are saved under `screenshots/social-ui-live-*`. No production chat, purchase, refund or publishing action was submitted during these read-only checks.

The initial stalled batch request was retired after the user chose sequential uploads and explicitly authorized disconnecting/reconnecting only the local publishing site. There was no batch broadcast; fees in the proof cover exactly the eleven individually confirmed transactions. The global spending pause remains unchanged.
