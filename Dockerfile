FROM node:20-alpine

RUN apk add --no-cache openssl

WORKDIR /app

EXPOSE 3000

ENV NODE_ENV=production

# Copy package files
COPY package.json package-lock.json* ./

# Install all dependencies needed to build the application
RUN npm ci

# Copy the application and Prisma schema
COPY . .

# Generate Prisma Client from the latest schema
RUN npx prisma generate

# Build Meal Deal Hub
RUN npm run build

# Remove development dependencies after building
RUN npm prune --omit=dev

# Start the application
CMD ["npm", "run", "docker-start"]