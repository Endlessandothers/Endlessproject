// killswitch-fn — stop the bleeding.
//
// Fired by a CloudWatch alarm when the public MCP endpoint is invoked more than
// the alarm's threshold in five minutes. It sets that function's reserved
// concurrency to zero, which throttles every subsequent request at the Lambda
// service before any code runs.
//
// WHY THIS RATHER THAN A RATE LIMITER.
//
// A rate limiter needs per-caller state on the hot path, and the hot path is
// exactly what a flood is trying to make expensive. Counting requests in
// DynamoDB would add a write to every request, including every request in the
// attack — the defence would scale its own cost with the attack's volume.
//
// This does the opposite. It costs nothing until it fires, and when it fires it
// costs nothing at all, because throttled invocations are not billed.
//
// WHAT IT TRADES AWAY.
//
// The endpoint goes down, for everyone, until a human puts it back. That is the
// right trade for a project on a free tier with one operator: an outage is
// recoverable and reversible in one command, and a surprise bill is neither.
// It is the wrong trade the moment there is a customer, and this file should be
// replaced with a real rate limiter before then rather than have its threshold
// quietly raised.
//
// It does not undo itself. Coming back requires looking at why it fired.

import {
  LambdaClient, PutFunctionConcurrencyCommand, GetFunctionConcurrencyCommand,
} from "@aws-sdk/client-lambda";
import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";

const lambda = new LambdaClient({});
const sns = new SNSClient({});

const TARGET = process.env.TARGET_FN;
const TOPIC = process.env.ALERT_TOPIC;

export const handler = async (event) => {
  // The alarm's own notification arrives as an SNS record. Read it for the
  // reason rather than assuming, so the alert says what actually tripped.
  let reason = "unknown";
  try {
    const msg = JSON.parse(event?.Records?.[0]?.Sns?.Message ?? "{}");
    reason = msg.NewStateReason ?? msg.AlarmDescription ?? reason;
  } catch { /* the alarm fired; the shape of its message is not worth failing over */ }

  const before = await lambda.send(new GetFunctionConcurrencyCommand({ FunctionName: TARGET }));
  const already = before.ReservedConcurrentExecutions === 0;

  if (!already) {
    await lambda.send(new PutFunctionConcurrencyCommand({
      FunctionName: TARGET,
      // Zero reserves nothing from the account pool, so this does not run into
      // the "unreserved must stay above the floor" rule that makes every other
      // reservation impossible on this account.
      ReservedConcurrentExecutions: 0,
    }));
  }

  const text = [
    already ? `${TARGET} was ALREADY throttled.` : `${TARGET} has been THROTTLED to zero concurrency.`,
    "",
    `Why: ${reason}`,
    "",
    "Nothing can call the MCP endpoint until this is undone. To restore:",
    `  aws lambda delete-function-concurrency --function-name ${TARGET}`,
    "",
    "Before restoring, look at why it fired. A legitimate spike and a flood look",
    "identical from here, and the difference is in the caller ids in the event log.",
  ].join("\n");

  console.log(JSON.stringify({ metric: "killswitch", target: TARGET, already, reason }));

  if (TOPIC) {
    await sns.send(new PublishCommand({
      TopicArn: TOPIC,
      Subject: `Endless: ${TARGET} throttled`,
      Message: text,
    }));
  }
  return { ok: true, throttled: true, already };
};
