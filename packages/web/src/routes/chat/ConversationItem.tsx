import { useState } from "react";
import { MoreVertical, Pencil, Trash2 } from "lucide-react";
import type { ConversationDto } from "../../lib/api.js";
import { cn } from "../../lib/utils.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "../../components/ui/dropdown-menu.js";

interface ConversationItemProps {
  conversation: ConversationDto;
  active: boolean;
  onSelect: () => void;
  onRename: (title: string) => void;
  onDelete: () => void;
}

export function ConversationItem({ conversation, active, onSelect, onRename, onDelete }: ConversationItemProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(conversation.title ?? "");

  const commit = () => {
    const next = draft.trim();
    setEditing(false);
    if (next && next !== conversation.title) onRename(next);
  };

  if (editing) {
    return (
      <div className="px-2 py-1">
        <input
          autoFocus
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") commit();
            if (event.key === "Escape") setEditing(false);
          }}
          className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm"
        />
      </div>
    );
  }

  return (
    <div
      className={cn(
        "group flex items-center gap-1 rounded-md px-2 py-2 text-sm",
        active ? "bg-zinc-800 text-zinc-100" : "text-zinc-300 hover:bg-zinc-900"
      )}
    >
      <button className="min-w-0 flex-1 truncate text-left" onClick={onSelect}>
        {conversation.title ?? "新会话"}
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            aria-label="会话操作"
            className="rounded p-1 text-zinc-400 opacity-0 hover:bg-zinc-700 group-hover:opacity-100 data-[state=open]:opacity-100"
          >
            <MoreVertical className="h-4 w-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onSelect={() => {
              setDraft(conversation.title ?? "");
              setEditing(true);
            }}
          >
            <Pencil className="h-4 w-4" /> 重命名
          </DropdownMenuItem>
          <DropdownMenuItem className="text-red-400" onSelect={onDelete}>
            <Trash2 className="h-4 w-4" /> 删除
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
