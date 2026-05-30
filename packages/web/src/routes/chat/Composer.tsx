import { useRef, useState } from "react";
import { Send, Square } from "lucide-react";
import { Button } from "../../components/ui/button.js";
import { Textarea } from "../../components/ui/textarea.js";

interface ComposerProps {
  isStreaming: boolean;
  disabled?: boolean;
  onSend: (content: string) => void;
  onStop: () => void;
}

export function Composer({ isStreaming, disabled, onSend, onStop }: ComposerProps) {
  const [value, setValue] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  const resize = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    const lineHeight = 24;
    const maxHeight = lineHeight * 8;
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
  };

  const send = () => {
    const trimmed = value.trim();
    if (!trimmed || isStreaming) return;
    onSend(trimmed);
    setValue("");
    requestAnimationFrame(resize);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  };

  return (
    <div className="border-t border-zinc-800 p-4">
      <div className="flex items-end gap-2">
        <Textarea
          ref={ref}
          rows={1}
          value={value}
          disabled={disabled}
          placeholder="输入消息，Enter 发送，Shift+Enter 换行"
          onChange={(event) => {
            setValue(event.target.value);
            resize();
          }}
          onKeyDown={onKeyDown}
        />
        {isStreaming ? (
          <Button variant="destructive" size="icon" onClick={onStop} aria-label="停止">
            <Square className="h-4 w-4" />
          </Button>
        ) : (
          <Button size="icon" onClick={send} disabled={disabled || value.trim().length === 0} aria-label="发送">
            <Send className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
}
