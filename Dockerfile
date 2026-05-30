FROM node:20-slim

# Build tools for better-sqlite3 native addon
RUN apt-get update && \
    apt-get install -y python3 make g++ && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install ALL deps (devDeps needed for vite+esbuild build step)
COPY package*.json ./
RUN npm ci

# Copy source and build frontend + backend
COPY . .
RUN npm run build

EXPOSE 3000
ENV NODE_ENV=production

# ESM output — import.meta.url works natively
CMD ["node", "dist/server.mjs"]
