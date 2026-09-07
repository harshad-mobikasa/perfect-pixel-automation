# syntax=docker/dockerfile:1
FROM mcr.microsoft.com/playwright:v1.60.0-jammy

WORKDIR /app

# Install dependencies with the private registry token (never baked into the image layer)
COPY package*.json .npmrc ./
RUN --mount=type=secret,id=npm_token \
    NPM_TOKEN="$(cat /run/secrets/npm_token)" npm ci && \
    rm -f .npmrc

COPY . .

RUN npm run build

EXPOSE 3000
ENV NODE_ENV=production \
    PLAYWRIGHT_BROWSERS_PATH=0

CMD ["npm", "start"]
