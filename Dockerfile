# Official Playwright image: Chromium and its system dependencies are preinstalled for the same
# version as @playwright/test in package.json. Keep this tag in sync with that pin.
FROM mcr.microsoft.com/playwright:v1.64.1-noble

WORKDIR /app

# Dependencies from the lockfile only; this layer is cached until package*.json changes. npm's
# download cache lives in a BuildKit cache mount, so it is reused across builds and not stored in the image.
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

COPY . .

# Offline unit tests by default. Anything else is an explicit command (see README).
CMD ["npm", "run", "test:unit"]
