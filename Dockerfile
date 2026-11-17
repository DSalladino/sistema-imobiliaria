# Imagem única para a demonstração pública ou para uma instalação pequena.
# Build: docker build -t sistema-imobiliaria .
# Demo:  docker run -p 3009:3009 -e DEMO_MODE=1 -e DEMO_DATA_DIR=/data sistema-imobiliaria
FROM node:24-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3009 \
    DEMO_DATA_DIR=/data \
    DEMO_RESET_HORAS=6

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY . .

RUN mkdir -p /data && chown -R node:node /app /data
USER node
VOLUME ["/data"]
EXPOSE 3009

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3009)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Para uma instalação real, troque o comando por: npm start
CMD ["npm", "run", "demo:servir"]
