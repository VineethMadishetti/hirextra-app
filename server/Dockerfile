# Use Node.js LTS version
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Install system dependencies for file processing
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    sqlite-dev

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production && npm cache clean --force

# Create non-root user
RUN addgroup -g 1001 -S nodejs
RUN adduser -S hirextra -u 1001

# Create necessary directories
RUN mkdir -p logs uploads temp_chunks
RUN chown -R hirextra:nodejs /app
USER hirextra

# Copy application code
COPY --chown=hirextra:nodejs . .

# Expose port
EXPOSE 5000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:5000/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) })"

# Start application
CMD ["npm", "start"]