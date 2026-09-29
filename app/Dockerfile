# A container with Node, two pages, and one vendored library.
#
# NO INSTALL STEP, STILL. The server uses node:http and the global fetch Node 22
# already has, so there is no package.json here and nothing is fetched at build
# time. That was the whole claim and it still holds for the server.
#
# It no longer holds for the page. public/vendor/three.module.js is a copy of
# three.js, checked in rather than pulled from a CDN at load: the page's CSP
# says script-src 'self', and relaxing that on a page that carries an API key is
# a bad trade for saving two megabytes of transfer. Vendoring moves the supply
# chain from "trust a CDN on every page load" to "trust a file somebody can read
# in the diff", which is the direction this project prefers to move things.
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
