# --- Dependencias (con herramientas de compilación por si better-sqlite3 no trae binario) ---
FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci --omit=dev

# --- Imagen final ---
FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DB_PATH=/app/data/muchotexto.db
WORKDIR /app
# --chown: el usuario node tiene que poder leer el código aunque en el
# ordenador los archivos tengan permisos restrictivos (p. ej. 600).
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package*.json check-node-version.cjs ./
COPY --chown=node:node src ./src
COPY --chown=node:node scripts ./scripts
RUN mkdir -p /app/data && chown -R node:node /app/data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/server.js"]
