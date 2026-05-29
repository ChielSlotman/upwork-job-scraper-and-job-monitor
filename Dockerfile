FROM apify/actor-node:22

COPY --chown=myuser:myuser package*.json ./
RUN npm ci --omit=dev

COPY --chown=myuser:myuser . ./

CMD ["npm", "start"]
