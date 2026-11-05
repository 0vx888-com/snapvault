# Content access and public-profile audit (local changes)

## Production interface inventory

- GET /healthz: health and chain only, no user records.
- GET /app-config.json, GET /api/wallet/config: public chain/contract configuration; not user balances or records.
- GET /tapesend/* and whitelisted frontend files: static client code, not inbox messages. No private keys are embedded.
- POST /api/wallet/challenge: address/public RSA key supplied by caller, nonce bound to origin; does not enumerate accounts.
- POST /api/wallet/login: nonce/signature required; returns only the authenticated account session.
- POST /api/wallet/state: previously returned **all profile-map wallet-address keys**, including private/non-creator users, full name/bio/avatar/creator metadata, and **delivery.circuits / delivery.tokenId** bindings. UID could be derived from every leaked address. Unknown future profile fields were also spread without filtering.
- Existing anonymous state did NOT expose actual friends, conversations, messages, order rows or earnings: those were already filtered by session account. No email collection/storage or actual email/balance fields were found in the current profile writer. Tests inject these sensitive fields to prove the new allowlist drops them.
- Anonymous state now returns only public works, display names and avatars, with opaque HMAC creator references rather than wallet keys or UIDs. Raw asset hash/URI, audience and conversation IDs are excluded. Public chain transactions still expose their on-chain addresses independently of this API.
- Authenticated state exposes own rows; other participants' profiles use display-name/avatar allowlists. Other members' message-open timestamp maps and burn storage references are stripped.
- POST profile-lookup: newly requires login, exact UID/address/opaque-public-ID only. 20 queries/account/min and 30 queries/IP/min. No bulk or prefix search. Frontend no longer downloads a full account directory to resolve UIDs.
- Friend mutation, orders in state, earnings, upload/open/message-open, delivery settings, conversation APIs require authenticated sessions. Request-body `who` cannot override the session identity. Refund lists retain their explicit owner-only moderation exception for submitted refund requests; a regular user sees only their own purchases/refunds.
- Old fixed GET /api/wallet/blob/:hash returns 410. GET /api/wallet/access/:token requires the issuing buyer's authenticated origin-bound session and responds no-store. Tokens are hashed at rest, consumed before response, and bounded by both token expiry and viewing expiry.
- claim-open now also requires the buyer's login in addition to a valid TapeSend claim. A forwarded link alone cannot fetch ciphertext.
- server/http.mjs is a separate integration-only loopback harness, not the production wallet router. Its Host/Origin and RPC boundaries remain; it must not be exposed as the production backend.

## Viewing and deletion semantics

A paid buyer receives one durable viewing grant per content/account, including across new sessions and restarts. The grant advertises a token expiry of viewing seconds + 10 seconds, while the viewing deadline can revoke it sooner. Public paid files are retained for other buyers. Creator previews are isolated from buyer grants. No anonymous fixed file URL is returned.

Burn chat payloads are migrated out of the live state into independently deletable local encrypted files. For a DM, finish notification or a one-second background timeout sweeper unlinks the payload and retains message metadata. Public sale ciphertext is not deleted. A private paid burn asset removes its live blob/key when finished. S3 currently holds encrypted backup snapshots, not separately addressable live chat-photo objects.

Browser countdown, viewer close and pagehide send finish notifications; if a browser disappears without delivery, server deadlines are authoritative. A disconnected browser cannot guarantee an immediate close callback. Already downloaded plaintext, screenshots or keys cannot be revoked.

## Existing backups and deployment boundary

This change does not delete historical local/S3 backups or rewrite mainnet history. Old snapshots may contain previously inline chat payloads or paid ciphertext. New burn-file bodies are not copied into the state-only backup, so restoring a state snapshot cannot resurrect an unlinked body. This also means burn files are intentionally unavailable if restoring state without the live burn directory. Removing or re-encrypting historical backup copies needs a separately reviewed retention/migration operation, not a claim of secure deletion by this patch.

Backend API and frontend must be released together later: old clients using fixed blob URLs will get 410; TapeSend viewing now needs buyer login. This task makes local commits only and must not push/deploy, access production storage, or send chain transactions.

## Local verification

- `hardhat test --no-compile`: 87 passed; 5 pre-existing optional browser tests not enabled (not counted as passing).
- `scripts/burn-chat.spec.mjs`: real browser chat → buyer-authenticated HTTP token fetch → countdown hides image → private file unlink passed; no chain RPC.
- `scripts/chat-xss.spec.mjs`: hostile text/image render regression passed.
- `scripts/vault-pin.spec.mjs`: fixed contract and chain safety regression passed with mocked wallet only.
- Production-mode frontend build completed locally; published=false.

Changed files across these local commits: server/view-access.mjs, server/wallet-service.mjs, server/wallet-http.mjs, server/workers.mjs, server/public-profiles.mjs; web/wallet.js, web/app.js, web/wallet-chat.js, web/store.js; test/ViewAccess.test.js, test/AccessHTTP.test.js, test/ProfilePrivacy.test.js, test/Wallet.test.js, test/WalletTapeSend.test.js; scripts/burn-chat.spec.mjs, scripts/chat-xss.spec.mjs; this document.
