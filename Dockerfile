# syntax=docker/dockerfile:1
FROM node:20-alpine

WORKDIR /app

# Install deps first (better layer caching)
COPY package.json ./
RUN npm install --omit=dev

# Copy project files
COPY src ./src
COPY scripts ./scripts
COPY db ./db
COPY README.md ./README.md

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "src/index.js"]
