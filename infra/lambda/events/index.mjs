// events-fn — the append-only writer.
//
// This function has no code path that updates or deletes, and its IAM role
// explicitly denies UpdateItem, DeleteItem and BatchWriteItem. Application code
// alone would not be enough: the guarantee has to survive someone editing this
// file later.

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { randomUUID } from "node:crypto";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const EVENTS = process.env.EVENTS_TABLE;

const json = (status, body) => ({
  statusCode: status,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

export const handler = async (event) => {
  const raw = event?.isBase64Encoded
    ? Buffer.from(event.body ?? "", "base64").toString("utf8")
    : event?.body;

  try {
    const body = raw ? JSON.parse(raw) : {};

    if (!body.type) return json(400, { error: "missing field: type" });

    // Provenance is not optional. An event that cannot be traced to an agent
    // and session is worthless for scoring and dangerous for gap analysis.
    if (!body.actor?.agent_id || !body.actor?.session_id) {
      return json(400, { error: "actor.agent_id and actor.session_id are required" });
    }

    const ts = new Date().toISOString();
    const event_id = randomUUID();

    await ddb.send(new PutCommand({
      TableName: EVENTS,
      Item: {
        event_id,
        ts,
        day: ts.slice(0, 10),
        type: body.type,
        actor: body.actor,
        payload: body.payload ?? {},
      },
      // Belt and braces: never overwrite an existing event id.
      ConditionExpression: "attribute_not_exists(event_id)",
    }));

    return json(201, { event_id, ts });
  } catch (err) {
    console.error(err);
    return json(500, { error: err.message });
  }
};
