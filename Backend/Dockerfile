FROM node:20-alpine

WORKDIR /app

# Install dependencies first (layer caching)
COPY package*.json ./
RUN npm install --production

# Copy ALL source files explicitly
COPY server.js ./
COPY src/ ./src/
COPY config/ ./config/
COPY database/ ./database/

# Create logs directory
RUN mkdir -p logs

# Verify critical files exist
RUN ls -la src/transactions/ && echo "✅ transactions folder found"
RUN ls -la src/pledge/ && echo "✅ pledge folder found"
RUN ls -la src/credit/ && echo "✅ credit folder found"

EXPOSE 3000

CMD ["node", "server.js"]
