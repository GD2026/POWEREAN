# PowerEAN – production image (used by Render, works on any Docker host).
# Build: install with the locked bun version, build the app with Vite.
FROM public.ecr.aws/docker/library/node:22-slim AS build
WORKDIR /src/app
RUN npm install -g bun@1.4.2
COPY app/package.json app/bun.lock app/bunfig.toml ./
COPY app/packages ./packages
RUN bun install --frozen-lockfile
COPY app/ ./
RUN npx vite build

# Run: just Node, the built files and the tiny server. No node_modules needed,
# the server bundle includes its dependencies.
FROM public.ecr.aws/docker/library/node:22-slim
ENV NODE_ENV=production \
    PORT=10000
WORKDIR /srv/app
COPY --from=build /src/app/dist ./dist
COPY --from=build /src/app/server ./server
USER node
EXPOSE 10000
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/node-server.mjs"]
