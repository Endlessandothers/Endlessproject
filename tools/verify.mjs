// Calls every catalog tool once against its real API and checks the documented
// probe path actually resolves.
//
// This is what makes the catalog a set of working wrappers rather than a list
// of URLs someone believed in. Run it before seeding, and again whenever a
// description is rewritten.
//
//   node tools/verify.mjs

import { loadCatalog, callTool, resolve } from "./call.mjs";

const catalog = loadCatalog();
const results = [];

for (const tool of catalog.tools) {
  try {
    const out = await callTool(tool);

    if (tool.probe === "__binary__") {
      const pass = out.ok && out.binary && out.bytes > 0;
      results.push({ id: tool.tool_id, pass, detail: pass ? `${out.type} ${out.bytes}B` : "no binary body", ms: out.ms });
      continue;
    }

    if (!out.ok) {
      results.push({ id: tool.tool_id, pass: false, detail: out.softFail ? `HTTP ${out.status} but error body` : `HTTP ${out.status}`, ms: out.ms });
      continue;
    }

    const value = resolve(out.body, tool.probe);
    const pass = value !== undefined && value !== null;
    const shown = typeof value === "object" ? JSON.stringify(value).slice(0, 48) : String(value).slice(0, 48);
    results.push({ id: tool.tool_id, pass, detail: pass ? `${tool.probe} = ${shown}` : `probe "${tool.probe}" did not resolve`, ms: out.ms });
  } catch (err) {
    results.push({ id: tool.tool_id, pass: false, detail: err.message.slice(0, 70), ms: 0 });
  }
}

for (const r of results) {
  console.log(`${r.pass ? "  ok  " : "  FAIL"} ${r.id.padEnd(24)} ${String(r.ms).padStart(5)}ms  ${r.detail}`);
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} tools live`);
if (failed.length) {
  console.log("failing: " + failed.map((f) => f.id).join(", "));
  process.exit(1);
}
