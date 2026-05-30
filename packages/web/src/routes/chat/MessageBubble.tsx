import type { MessageDto } from "../../lib/api.js";
import { MarkdownView } from "./MarkdownView.js";
import { cn } from "../../lib/utils.js";

interface MessageBubbleProps {
  message: Pick<MessageDto, "role" | "content" | "status" | "errorCode">;
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === "user";

  if (message.role === "assistant" && message.status === "error") {
    return (
      <div className="flex justify-start">
        <div className="max-w-[80%] rounded-lg border border-red-900 bg-red-950/60 px-4 py-2 text-sm text-red-200">
          上游服务异常{message.errorCode ? `（${message.errorCode}）` : ""}，请重试。
        </div>
      </div>
    );
  }

  return (
    <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[80%] rounded-lg px-4 py-2",
          isUser ? "bg-blue-600 text-white" : "bg-zinc-800 text-zinc-100"
        )}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap break-words text-sm">{message.content}</p>
        ) : (
          <>
            <MarkdownView content={message.content} />
            {message.status === "aborted" && (
              <span className="mt-1 inline-block text-xs text-zinc-400">已中断</span>
            )}
          </>
        )}
      </div>
    </div>
  );
}
