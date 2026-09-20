# endless-app

A window onto the network, for people rather than agents. Everything else is
reachable over MCP or from a terminal; this is a page you can open.

```
docker build -t endless-app app
docker run --rm -p 8080:8080 \
  -e MCP_URL=https://<mcp-function-url>/ \
  -e BOARD_URL=https://<cloudfront-domain>/ \
  endless-app
```

## It holds no key

The one rule this app lives by. A visitor brings their own key; the app forwards
it and keeps nothing — no session, no store, no log.

It would be easier to put one key in an environment variable and let anyone use
the page. But then every visitor would arrive as the **same caller**, and every
count the registry rests on — how many separate people needed a thing, how many
owners are behind a cluster, which tools compete — would silently collapse to
one. The registry would be unable to tell a hundred people from one person a
hundred times.

That is also why the container needs no AWS credentials. Its task role grants
nothing, because there is nothing for it to be granted.

## Its own network

It runs in a separate VPC from everything else, with its own internet gateway.

The sandbox VPC deliberately has **no route out** — that absence is the entire
execution guarantee, proven by 22 live escape tests. Putting a public-facing
container in it would mean adding an internet gateway to the one network whose
value is not having one.
