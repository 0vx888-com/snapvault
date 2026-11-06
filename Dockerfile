FROM node:24-bookworm-slim AS build
WORKDIR /app
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY hardhat.config.js ./
COPY contracts ./contracts
RUN node node_modules/hardhat/internal/cli/cli.js compile
COPY scripts/build-app.mjs scripts/public-build.mjs scripts/optimize-public.mjs scripts/app-files.mjs ./scripts/
COPY web/product-ui.css web/product-ui.js web/i18n.js web/social.js web/screen-privacy.js ./web/
COPY web/index.html web/style.css web/app.js web/chat.js web/store.js web/local-delivery.js web/wallet.js web/wallet-connect.js web/transaction-guard.js web/wallet-chat.js web/refunds.js web/safe-dom.js web/chat-ui.js web/publish-ui.js web/ui-icons.js ./web/
COPY web/vendor/ethers.min.js web/vendor/ethers-LICENSE.md web/vendor/okx-connect.min.js web/vendor/okx-connect-LICENSE.md ./web/vendor/
COPY web/assets/wallet-icon.png web/assets/mark-tape.svg web/assets/social-photos.jpg web/assets/studio.svg web/assets/sketch.svg ./web/assets/
RUN node scripts/build-app.mjs --server --allow-mainnet

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production BIND=0.0.0.0
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY --from=build /app/artifacts/contracts/SnapVaultDirect.sol/SnapVaultDirect.json ./artifacts/contracts/SnapVaultDirect.sol/SnapVaultDirect.json
COPY scripts/app-files.mjs scripts/backup-state.mjs scripts/recover-view-ledger.mjs scripts/check-safe-rollback.mjs scripts/migrate-views-once.mjs scripts/production-storage-inventory.cjs ./scripts/
COPY vendor/tapekit-send ./vendor/tapekit-send
COPY server ./server
COPY public/tapesend ./public/tapesend
COPY --from=build /app/dist/server ./web
CMD ["node", "server/wallet-start.mjs"]
