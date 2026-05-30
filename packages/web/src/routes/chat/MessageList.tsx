import { useEffect, useRef } from "react";
import type { MessageDto } from "../../lib/api.js";
import { MessageBubble } from "./MessageBubble.js";

export interface ChatMessage extends Pick<MessageDto, "id" | "role" | "content" | "status" | "errorCode"> {}

interface MessageListProps {
  messages: ChatMessage[];
  streamingContent?: string;
  isStreaming: boolean;
}

export function MessageList({ messages, streamingContent, isStreaming }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingContent]);

  return (
    <div className="flex-1 space-y-4 overflow-y-auto px-6 py-6">
      {messages.map((message) => (
        <MessageBubble key={message.id} message={message} />
      ))}
      {isStreaming && (
        <MessageBubble
          message={{ role: "assistant", content: streamingContent ?? "", status: "streaming", errorCode: null }}
        />
      )}
      <div ref={bottomRef} />
    </div>
  );
}
