FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/protocol/package.json packages/protocol/package.json
COPY apps/signaling/package.json apps/signaling/package.json
COPY apps/extension/package.json apps/extension/package.json
RUN npm ci
COPY packages/protocol packages/protocol
COPY apps/signaling apps/signaling
RUN npm run build -w @ghostpair/protocol && npm run build -w @ghostpair/signaling
RUN npm prune --omit=dev

FROM node:24-bookworm-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8787 DATABASE_PATH=/data/ghostpair.sqlite
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/packages/protocol ./packages/protocol
COPY --from=build /app/apps/signaling ./apps/signaling
COPY docs/privacy.html ./docs/privacy.html
RUN mkdir /data && chown node:node /data
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=7s --start-period=15s --retries=3 CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/ready',{signal:AbortSignal.timeout(6000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/signaling/dist/main.js"]
