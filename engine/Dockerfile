FROM node:22-slim

WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY src ./src

# Cloud Run injects PORT — index.js already reads process.env.PORT.
CMD ["node", "src/index.js"]
