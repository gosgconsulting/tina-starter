# Multi-stage Dockerfile for TinaCMS + Next.js application

# Stage 1: Dependencies
FROM node:18-alpine AS deps
WORKDIR /app

# Copy package files
COPY package*.json ./
COPY pnpm-lock.yaml ./

# Install dependencies
RUN npm ci --only=production && npm cache clean --force

# Stage 2: TinaCMS Builder
FROM node:18-alpine AS tina-builder
WORKDIR /app

# Copy package files and install all dependencies (including dev dependencies)
COPY package*.json ./
COPY pnpm-lock.yaml ./
RUN npm ci

# Copy source code
COPY . .

# Build TinaCMS and generate static files
RUN npm run build-offline-server

# Stage 3: Next.js Builder
FROM node:18-alpine AS next-builder
WORKDIR /app

# Copy package files
COPY package*.json ./
COPY pnpm-lock.yaml ./

# Install all dependencies
RUN npm ci

# Copy source code
COPY . .

# Copy the generated TinaCMS files from the previous stage
COPY --from=tina-builder /app/tina/__generated__ ./tina/__generated__/

# Build Next.js application
RUN npm run build

# Stage 4: Production Runtime
FROM node:18-alpine AS runner
WORKDIR /app

# Create a non-root user
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy built application
COPY --from=next-builder /app/.next ./.next
COPY --from=next-builder /app/public ./public
COPY --from=next-builder /app/package*.json ./

# Copy TinaCMS admin files
COPY --from=tina-builder /app/public/admin ./public/admin

# Install only production dependencies
RUN npm ci --only=production && npm cache clean --force

# Change ownership to nextjs user
RUN chown -R nextjs:nodejs /app
USER nextjs

# Expose port
EXPOSE 3000

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000

# Start the application
CMD ["npm", "start"]
