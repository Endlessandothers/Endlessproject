# A container with nothing in it but Node and two files.
#
# No dependencies, so no lockfile, no install step and no supply chain: the app
# uses node:http and the global fetch that Node 22 already has. The smallest
# thing that can be reviewed is the smallest thing that can be trusted, and this
# one is a server and a page.
FROM node:22-alpine

# Runs as the node user, not root. The container holds no credentials and needs
# no privileges; there is nothing here worth being root for.
WORKDIR /app
COPY --chown=node:node server.mjs ./
COPY --chown=node:node public ./public
USER node

ENV NODE_ENV=production PORT=8080
EXPOSE 8080

# Node's own signal handling as PID 1 is fine for a server with no children and
# no shutdown work — the task holds nothing that needs flushing.
CMD ["node", "server.mjs"]
