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

# Debug: show exactly what got copied
RUN echo "=== /app contents ===" && ls -la
RUN echo "=== /app/src contents ===" && ls -la src/

EXPOSE 3000

CMD ["node", "server.js"]
