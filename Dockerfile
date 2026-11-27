FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server.js ./
COPY src ./src
COPY views ./views
COPY public ./public
# The database and uploaded files live in /data, which must be a persistent volume.
ENV DATA_DIR=/data PORT=8080 TRUST_PROXY=1
EXPOSE 8080
CMD ["node", "server.js"]
