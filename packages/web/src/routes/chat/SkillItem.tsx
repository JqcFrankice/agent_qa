import { CheckCircle2, Clock, Globe, Lock, MoreVertical, Pencil, Trash2, XCircle } from "lucide-react";
import type { SkillDto } from "@server-agent/shared";
import { Button } from "../../components/ui/button.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "../../components/ui/dropdown-menu.js";

interface SkillItemProps {
  skill: SkillDto;
  onUse: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onTogglePublic: () => void;
}

function ReviewBadge({ skill }: { skill: SkillDto }) {
  if (!skill.isPublic) return null;
  if (skill.reviewStatus === "approved") {
    return <CheckCircle2 className="inline h-3 w-3 text-green-500" aria-label="已通过审核" />;
  }
  if (skill.reviewStatus === "pending") {
    return <Clock className="inline h-3 w-3 text-yellow-500" aria-label="审核中" />;
  }
  return (
    <span title={skill.rejectReason ?? "审核未通过"} className="inline-flex">
      <XCircle className="inline h-3 w-3 text-red-500" aria-label="审核未通过" />
    </span>
  );
}

export function SkillItem({ skill, onUse, onEdit, onDelete, onTogglePublic }: SkillItemProps) {
  return (
    <div className="group flex items-center gap-2 rounded px-2 py-1.5 hover:bg-zinc-800">
      <button
        className="min-w-0 flex-1 truncate text-left text-sm"
        onClick={onUse}
        title={skill.description || skill.title}
      >
        <span className="mr-1 inline-flex items-center gap-0.5">
          {skill.isPublic ? (
            <Globe className="inline h-3 w-3" />
          ) : (
            <Lock className="inline h-3 w-3" />
          )}
          <ReviewBadge skill={skill} />
        </span>
        {skill.title}
        {!skill.isOwn && (
          <span className="ml-1 text-xs text-zinc-500">@{skill.authorUsername}</span>
        )}
      </button>
      {skill.isOwn && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Skill 操作"
              className="h-6 w-6 opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100"
            >
              <MoreVertical className="h-3 w-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onEdit}>
              <Pencil className="h-3 w-3" /> 编辑
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onTogglePublic}>
              {skill.isPublic ? "设为私有" : "公开发布"}
            </DropdownMenuItem>
            <DropdownMenuItem className="text-red-400" onSelect={onDelete}>
              <Trash2 className="h-3 w-3" /> 删除
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
