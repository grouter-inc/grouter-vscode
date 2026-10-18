import { setDefaultResultOrder } from "node:dns";
setDefaultResultOrder("ipv4first");

import { SkillEngine } from "../skills/engine";
import { skillsDir } from "../skills/engine";

const engine = new SkillEngine();
const written = engine.seedBuiltins();

console.log(`[seed-skills] skills dir: ${skillsDir()}`);
console.log(`[seed-skills] seeded ${written.length} new skill file(s)`);
for (const file of written) {
  console.log(`  + ${file}`);
}
console.log(`[seed-skills] total skills available: ${engine.list().length}`);
