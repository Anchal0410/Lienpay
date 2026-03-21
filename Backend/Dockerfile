FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --production

ARG CACHE_BUST=4
RUN echo "Cache bust: $CACHE_BUST"

COPY server.js ./
COPY config/ ./config/
COPY database/ ./database/

# Copy each src subfolder explicitly
COPY src/auth/ ./src/auth/
COPY src/kyc/ ./src/kyc/
COPY src/middleware/ ./src/middleware/
COPY src/utils/ ./src/utils/
COPY src/portfolio/ ./src/portfolio/
COPY src/risk/ ./src/risk/
COPY src/pledge/ ./src/pledge/
COPY src/credit/ ./src/credit/
COPY src/transactions/ ./src/transactions/

RUN mkdir -p logs

RUN echo "=== src folders ===" && ls -la src/

EXPOSE 3000

CMD ["node", "server.js"]
