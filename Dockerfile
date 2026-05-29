FROM apify/actor-node-playwright-chrome:22-1.60.0

COPY --chown=myuser:myuser package*.json ./
RUN npm ci --omit=dev

COPY --chown=myuser:myuser . ./

CMD ["npm", "start"]
