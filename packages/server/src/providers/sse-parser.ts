export interface SseFrame {
  event: string;
  data: string;
}

export class SseFrameParser {
  private buffer = "";

  push(chunk: string): SseFrame[] {
    this.buffer = (this.buffer + chunk).replace(/\r\n/g, "\n");
    const frames: SseFrame[] = [];
    let index: number;
    while ((index = this.buffer.indexOf("\n\n")) >= 0) {
      const raw = this.buffer.slice(0, index);
      this.buffer = this.buffer.slice(index + 2);
      const frame = parseFrame(raw);
      if (frame) frames.push(frame);
    }
    return frames;
  }
}

function parseFrame(raw: string): SseFrame | null {
  let event = "message";
  const data: string[] = [];
  for (const line of raw.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
  }
  if (data.length === 0) return null;
  return { event, data: data.join("\n") };
}
