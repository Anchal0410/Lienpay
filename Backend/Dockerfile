FROM node:20-alpine

WORKDIR /app

# Install dependencies first (layer caching)
COPY package*.json ./
RUN npm install --production

# Add cache buster - change this value to force fresh copy
ARG CACHE_BUST=3
RUN echo "Cache bust: $CACHE_BUST"

# Copy ALL source files
COPY server.js ./
COPY src/ ./src/
COPY config/ ./config/
COPY database/ ./database/

# Create logs directory
RUN mkdir -p logs

# Verify all folders copied correctly
RUN echo "=== src folders ===" && ls -la src/

EXPOSE 3000

CMD ["node", "server.js"]
