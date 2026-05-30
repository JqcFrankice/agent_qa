import { describe, expect, it } from "vitest";
import { SseFrameParser } from "../../../src/providers/sse-parser.js";

describe("SseFrameParser", () => {
  it("parses frames split across chunks", () => {
    const parser = new SseFrameParser();
    expect(parser.push("event: delta\ndata: {\"text\":\"Hel")).toEqual([]);
    expect(parser.push("lo\"}\n\n")).toEqual([{ event: "delta", data: "{\"text\":\"Hello\"}" }]);
  });

  it("supports CRLF frame separators", () => {
    const parser = new SseFrameParser();
    expect(parser.push("event: done\r\ndata: {}\r\n\r\n")).toEqual([{ event: "done", data: "{}" }]);
  });

  it("defaults event name to message and joins multiline data", () => {
    const parser = new SseFrameParser();
    expect(parser.push("data: a\ndata: b\n\n")).toEqual([{ event: "message", data: "a\nb" }]);
  });
});
