# syntax=docker/dockerfile:1.7

# ---------- Stage 1: build ----------
FROM node:22-alpine AS builder

WORKDIR /app

# Install deps with a clean, reproducible tree
COPY package.json package-lock.json ./
RUN npm ci

# Copy sources and build for production
COPY . .
RUN npm run build -- --configuration=production

# ---------- Stage 2: runtime ----------
FROM nginx:alpine AS runtime

# Drop root privileges for the nginx worker
RUN addgroup -S app && adduser -S app -G app \
    && chown -R app:app /var/cache/nginx /var/log/nginx /etc/nginx \
    && touch /var/run/nginx.pid \
    && chown -R app:app /var/run/nginx.pid \
    && chown -R app:app /usr/share/nginx/html

COPY --chown=app:app nginx.conf /etc/nginx/nginx.conf
COPY --from=builder --chown=app:app /app/dist/my-cars-hub-front-end/browser /usr/share/nginx/html

USER app

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
