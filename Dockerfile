FROM node:22-alpine

RUN apk add --no-cache openssl

WORKDIR /app

EXPOSE 3000

ENV NODE_ENV=production

# Copy package files
COPY package.json package-lock.json* ./

# Install dependencies
RUN npm ci

# Copy application files
COPY . .

# Generate Prisma Client
RUN npx prisma generate

# Build Meal Deal Hub
RUN npm run build

# Remove development dependencies
RUN npm prune --omit=dev

# Start application
CMD ["npm", "run", "docker-start"]