FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --omit=dev --workspace server --include-workspace-root=false

FROM node:22-bookworm-slim
ENV NODE_ENV=production DATA_DIR=/data PORT=3000 TZ_APP=America/Argentina/Buenos_Aires
WORKDIR /app/server
COPY --from=deps /app/node_modules /app/node_modules
COPY --from=build /app/server/dist ./dist
COPY --from=build /app/server/package.json ./package.json
COPY --from=build /app/web/dist /app/web/dist
COPY deploy/entrypoint.sh /entrypoint.sh
RUN mkdir -p /data && chown node:node /data && chmod +x /entrypoint.sh
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=60s --timeout=5s CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "dist/index.js"]
