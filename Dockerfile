# Multi-stage build for Lottie render service

# Stage 1: Build
FROM node:20-bookworm AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# The builder stage only needs to compile TypeScript; Playwright's browser
# binary is downloaded explicitly in the production stage below instead.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

# Install dependencies
RUN npm ci --ignore-scripts

# Copy source code
COPY . .

# Build TypeScript
RUN npm run build

# Keep development tools out of the runtime image.
FROM builder AS production-deps
RUN npm prune --omit=dev --ignore-scripts

# Stage 2: Production
FROM node:20-bookworm-slim

# Install system dependencies for Playwright and FFmpeg
RUN apt-get update && apt-get install -y \
    # FFmpeg for video composition
    ffmpeg \
    # Playwright Chromium dependencies
    libnss3 \
    libnspr4 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    libpango-1.0-0 \
    libcairo2 \
    # Fonts
    fonts-liberation \
    fonts-noto-color-emoji \
    # Clean up
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Create non-root user
RUN useradd -m -u 1001 appuser && \
    chown -R appuser:appuser /app

# Copy built application from builder
COPY --from=production-deps --chown=appuser:appuser /app/node_modules ./node_modules
COPY --from=builder --chown=appuser:appuser /app/package.json ./

# Create necessary directories
RUN mkdir -p videos logs && \
    chown -R appuser:appuser videos logs

# Switch to non-root user
USER appuser

# Install Playwright Chromium
RUN npx playwright install --only-shell chromium

# Copy application files after browser installation so code-only changes reuse it.
COPY --from=builder --chown=appuser:appuser /app/dist ./dist
COPY --chown=appuser:appuser templates ./templates
COPY --chown=appuser:appuser public ./public

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/api/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1); }).on('error', () => process.exit(1));"

# Start application
CMD ["node", "dist/server/start.js"]
