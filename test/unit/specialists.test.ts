import { describe, it, expect } from "vitest";
import { SPECIALISTS, getSpecialist, subsetRegistry, specialistToolSpecs } from "../../src/agent/specialists";
import { createDefaultRegistry } from "../../src/tools/registry";

describe("specialists", () => {
  it("defines 4 specialists with tools and prompts", () => {
    expect(SPECIALISTS.length).toBe(4);
    for (const s of SPECIALISTS) {
      expect(s.id).toBeTruthy();
      expect(s.description.length).toBeGreaterThan(20);
      expect(s.systemPrompt.length).toBeGreaterThan(50);
      expect(s.tools.length).toBeGreaterThan(0);
      expect(s.maxIterations).toBeGreaterThan(0);
    }
  });

  it("all specialists are read-only (V1 safety)", () => {
    for (const s of SPECIALISTS) {
      expect(s.readOnly).toBe(true);
    }
  });

  it("all specialist tool ids exist in the default registry", () => {
    const registry = createDefaultRegistry();
    for (const s of SPECIALISTS) {
      for (const toolId of s.tools) {
        expect(registry.get(toolId), `${s.id} references missing tool ${toolId}`).toBeDefined();
      }
    }
  });

  it("getSpecialist resolves by id", () => {
    expect(getSpecialist("explorer")?.name).toBe("Codebase Explorer");
    expect(getSpecialist("nope")).toBeUndefined();
  });

  it("subsetRegistry contains exactly the specialist's tools", () => {
    const full = createDefaultRegistry();
    const explorer = getSpecialist("explorer")!;
    const sub = subsetRegistry(full, explorer.tools);
    expect(sub.all().length).toBe(explorer.tools.length);
    expect(sub.get("read_file")).toBeDefined();
    expect(sub.get("write_file")).toBeUndefined();
    expect(sub.get("run_command")).toBeUndefined();
  });

  it("specialistToolSpecs filters to existing tools", () => {
    const registry = createDefaultRegistry();
    const specs = specialistToolSpecs(registry, SPECIALISTS);
    expect(specs.length).toBe(4);
    for (const spec of specs) {
      expect(spec.tools.length).toBeGreaterThan(0);
      for (const t of spec.tools) {
        expect(registry.get(t)).toBeDefined();
      }
    }
  });
});
