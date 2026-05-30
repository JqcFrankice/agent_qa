import { Plus, LogOut } from "lucide-react";
import type { ConversationDto } from "../../lib/api.js";
import { Button } from "../../components/ui/button.js";
import { Skeleton } from "../../components/ui/skeleton.js";
import { ConversationItem } from "./ConversationItem.js";

interface SidebarProps {
  conversations: ConversationDto[];
  isLoading: boolean;
  activeId: string | null;
  username: string;
  onSelect: (id: string) => void;
  onNew: () => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onLogout: () => void;
}

export function Sidebar({
  conversations,
  isLoading,
  activeId,
  username,
  onSelect,
  onNew,
  onRename,
  onDelete,
  onLogout
}: SidebarProps) {
  return (
    <aside className="flex w-[260px] flex-shrink-0 flex-col border-r border-zinc-800 bg-zinc-950">
      <div className="p-3">
        <Button className="w-full justify-start gap-2" onClick={onNew}>
          <Plus className="h-4 w-4" /> 新建会话
        </Button>
      </div>
      <div className="flex-1 space-y-1 overflow-y-auto px-2 pb-2">
        {isLoading ? (
          <div className="space-y-2 px-1">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : conversations.length === 0 ? (
          <p className="px-2 py-4 text-sm text-zinc-500">还没有会话</p>
        ) : (
          conversations.map((conversation) => (
            <ConversationItem
              key={conversation.id}
              conversation={conversation}
              active={conversation.id === activeId}
              onSelect={() => onSelect(conversation.id)}
              onRename={(title) => onRename(conversation.id, title)}
              onDelete={() => onDelete(conversation.id)}
            />
          ))
        )}
      </div>
      <div className="flex items-center justify-between border-t border-zinc-800 p-3">
        <span className="truncate text-sm text-zinc-400">{username}</span>
        <Button variant="ghost" size="icon" aria-label="登出" onClick={onLogout}>
          <LogOut className="h-4 w-4" />
        </Button>
      </div>
    </aside>
  );
}
