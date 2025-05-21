FROM node:22.12-alpine as builder

WORKDIR /app

COPY package.json package-lock.json ./
COPY mcp-server.js version.js ./

RUN --mount=type=cache,target=/root/.npm npm install

FROM node:22-alpine AS release

# Create app directory 
WORKDIR /app

# Copy only the necessary files
COPY --from=builder /app/mcp-server.js /app/mcp-server.js
COPY --from=builder /app/version.js /app/version.js
COPY --from=builder /app/package.json /app/package.json
COPY --from=builder /app/package-lock.json /app/package-lock.json

ENV NODE_ENV=production
# By default, let the app choose storage automatically
# Users can override this by setting STORAGE_PATH when running the container
ENV STORAGE_PATH=""

RUN npm ci --ignore-scripts --omit-dev

# We don't need to explicitly create a volume since the app will 
# choose an appropriate storage location based on environment
# But we document where a volume might be mounted for persistent storage
VOLUME /data

# Provide instructions about storage configuration
LABEL org.opencontainers.image.description="MCP server for change plan management. Mount a volume to /data and set STORAGE_PATH=/data for persistent storage."

ENTRYPOINT ["node", "mcp-server.js"] 