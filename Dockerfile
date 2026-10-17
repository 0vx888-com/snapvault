FROM node:24-bookworm-slim AS build
WORKDIR /app
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY hardhat.config.js ./
COPY contracts ./contracts
RUN node node_modules/hardhat/internal/cli/cli.js compile

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production BIND=0.0.0.0
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/artifacts/contracts/SnapVaultDirect.sol/SnapVaultDirect.json ./artifacts/contracts/SnapVaultDirect.sol/SnapVaultDirect.json
COPY package.json ./
COPY server ./server
COPY web ./web
CMD ["node", "server/wallet-start.mjs"]
