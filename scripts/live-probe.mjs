/**
 * Live gateway probe used by the screenshot harness.
 *
 * Prints a one-line proof for /v1/models and /v1/chat/completions. The API key is
 * read from ~/.grouter/config.json and never printed.
 *
 * Usage: node scripts/live-probe.mjs models|chat
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const cfg = JSON.parse(readFileSync(join(homedir(), ".grouter", "config.json"), "utf8"));
const base = String(cfg.baseUrl).replace(/\/$/, "");
const auth = { Authorization: `Bearer ${cfg.apiKey}` };

const which = process.argv[2] ?? "models";

if (which === "models") {
  const res = await fetch(`${base}/models`, { headers: auth });
  const body = await res.json();
  const ids = body.data.map((m) => m.id);
  console.log(`HTTP ${res.status} — models: ${ids.length}`);
  console.log(ids.join(", "));
} else {
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: cfg.model,
      messages: [{ role: "user", content: "Balas satu kalimat: halo dari gRouter" }],
    }),
  });
  // The gateway appends a trailing "data: [DONE]" SSE marker after the JSON body.
  const text = await res.text();
  const json = JSON.parse(text.slice(0, text.indexOf("data:") === -1 ? undefined : text.indexOf("data:")));
  console.log(`reply: ${json.choices[0].message.content}`);
}
