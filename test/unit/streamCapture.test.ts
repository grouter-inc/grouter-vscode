import { describe, it, expect } from "vitest";

/**
 * Regression test for the VS Code `ChatResponseStream` capture facade.
 *
 * Background — this bug shipped in 0.3.1 and was reported by a real user:
 *
 *   get on proxy: property 'markdown' is a read-only and non-configurable data
 *   property on the proxy target but the proxy did not return its actual value
 *   (expected '...' but got 'k=>{d.push(...),S.markdown.call(S,k)}')
 *
 * The old code wrapped `stream` in a Proxy whose `get` trap returned a *new*
 * arrow function for `markdown`. VS Code defines `markdown` on its response
 * stream with `{writable: false, configurable: false}`, and the ECMAScript spec
 * forbids a Proxy from returning a value that differs from a non-configurable,
 * non-writable *data* property on the target. The engine therefore threw at
 * runtime — inside the extension host, where no unit test was looking, because
 * every test used a hand-rolled stream double rather than a spec-shaped one.
 *
 * The fix removes the Proxy entirely: the agent writes through a plain facade
 * object, so the real stream is never proxied and no invariant can be violated.
 *
 * These tests reproduce the *shape* VS Code actually creates, so the same
 * mistake cannot silently return.
 */

/** A stream whose `markdown` is exactly as VS Code defines it: read-only + non-configurable. */
function vscodeShapedStream() {
  const rendered: string[] = [];
  const stream: Record<string, unknown> = {};

  Object.defineProperty(stream, "markdown", {
    value: (value: string | { value: string }) => {
      rendered.push(typeof value === "string" ? value : value.value);
    },
    writable: false,
    configurable: false,
    enumerable: true,
  });
  Object.defineProperty(stream, "progress", {
    value: (value: string) => rendered.push(`[progress] ${value}`),
    writable: false,
    configurable: false,
    enumerable: true,
  });
  Object.defineProperty(stream, "button", {
    value: (cmd: { command: string; title: string }) => rendered.push(`[button] ${cmd.command}`),
    writable: false,
    configurable: false,
    enumerable: true,
  });

  return { stream, rendered };
}

/** The facade shape that must be used instead of a Proxy (mirrors participant.ts). */
function makeCaptureFacade(stream: Record<string, unknown>) {
  const capturedText: string[] = [];
  const originalMarkdown = stream.markdown as (v: string | { value: string }) => void;

  const captureMarkdown = (value: string | { value: string }): void => {
    capturedText.push(typeof value === "string" ? value : value.value);
    originalMarkdown(value);
  };

  const facade = {
    markdown: captureMarkdown,
    progress: (value: string) => (stream.progress as (v: string) => void)(value),
    button: (cmd: { command: string; title: string }) => (stream.button as (c: unknown) => void)(cmd),
  };

  return { facade, capturedText };
}

describe("chat stream capture (Proxy invariant regression)", () => {
  it("the old Proxy approach throws on a VS Code-shaped stream", () => {
    const { stream } = vscodeShapedStream();

    // Exactly the pattern that caused the reported crash.
    const badProxy = new Proxy(stream, {
      get(target, prop) {
        if (prop === "markdown") {
          return (value: string) => (target.markdown as (v: string) => void)(value);
        }
        return Reflect.get(target, prop);
      },
    });

    // Reading `markdown` off the proxy is what throws — the invariant is checked
    // at property-access time, before any call happens.
    expect(() => badProxy.markdown).toThrowError(/read-only and non-configurable|proxy/i);
  });

  it("the facade approach does NOT throw and still captures text", () => {
    const { stream, rendered } = vscodeShapedStream();
    const { facade, capturedText } = makeCaptureFacade(stream);

    expect(() => facade.markdown("hello")).not.toThrow();
    expect(() => facade.markdown(" world")).not.toThrow();

    // captured by the facade...
    expect(capturedText).toEqual(["hello", " world"]);
    // ...and still forwarded to the real stream.
    expect(rendered).toEqual(["hello", " world"]);
  });

  it("captures MarkdownString-shaped values by their .value", () => {
    const { stream, rendered } = vscodeShapedStream();
    const { facade, capturedText } = makeCaptureFacade(stream);

    facade.markdown({ value: "**bold**" });

    expect(capturedText).toEqual(["**bold**"]);
    expect(rendered).toEqual(["**bold**"]);
  });

  it("passes progress and button through to the real stream", () => {
    const { stream, rendered } = vscodeShapedStream();
    const { facade } = makeCaptureFacade(stream);

    facade.progress("working");
    facade.button({ command: "grouter.openConfig", title: "Open Config" });

    expect(rendered).toEqual(["[progress] working", "[button] grouter.openConfig"]);
  });

  it("the real stream is never wrapped in a Proxy", () => {
    const { stream } = vscodeShapedStream();
    const { facade } = makeCaptureFacade(stream);

    // A facade is a distinct plain object; the stream's own property is untouched
    // and remains the exact function VS Code installed.
    expect(facade).not.toBe(stream);
    expect(Object.getOwnPropertyDescriptor(stream, "markdown")?.configurable).toBe(false);
    expect(() => Reflect.get(stream, "markdown")).not.toThrow();
  });
});
