FROM node:20-alpine

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm install --production

# Copy application files
COPY server.js ./
COPY config/ ./config/
COPY database/ ./database/
COPY src/ ./src/

RUN mkdir -p logs

EXPOSE 3000

CMD ["node", "server.js"]
