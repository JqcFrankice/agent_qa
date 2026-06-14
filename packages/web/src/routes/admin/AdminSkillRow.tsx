import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { AdminSkillDto } from "../../lib/admin.js";
import { Button } from "../../components/ui/button.js";

interface Props {
  skill: AdminSkillDto;
  onApprove: () => void;
  onReject: () => void;
  busy?: boolean;
}

export function AdminSkillRow({ skill, onApprove, onReject, busy }: Props) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="rounded-md border border-zinc-800 p-3">
      <div className="flex items-start gap-2">
        <button
          className="mt-1 text-zinc-400 hover:text-zinc-200"
          onClick={() => setExpanded((v) => !v)}
          aria-label="展开"
        >
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-sm">
            <span className="font-medium">#{skill.id}</span>
            <span className="truncate">{skill.title}</span>
            <span className="text-xs text-zinc-500">@{skill.authorUsername}</span>
            <span className="text-xs text-zinc-500">v{skill.version}</span>
          </div>
          <p className="truncate text-xs text-zinc-400">
            {skill.description || "（无描述）"}
          </p>
          {skill.reviewStatus === "rejected" && skill.rejectReason ? (
            <p className="mt-1 text-xs text-red-400">已拒绝：{skill.rejectReason}</p>
          ) : null}
        </div>
        {skill.reviewStatus === "pending" ? (
          <div className="flex gap-1">
            <Button size="sm" onClick={onApprove} disabled={busy}>通过</Button>
            <Button size="sm" variant="destructive" onClick={onReject} disabled={busy}>拒绝</Button>
          </div>
        ) : null}
      </div>
      {expanded ? (
        <div className="mt-3 space-y-2 pl-6 text-xs">
          <div>
            <p className="mb-1 text-zinc-400">System Prompt</p>
            <pre className="whitespace-pre-wrap rounded bg-zinc-900 p-2 text-zinc-300">{skill.systemPrompt}</pre>
          </div>
          {skill.inputSchema && skill.inputSchema.length > 0 ? (
            <div>
              <p className="mb-1 text-zinc-400">Input Schema（{skill.inputSchema.length} 个字段）</p>
              <ul className="space-y-1">
                {skill.inputSchema.map((f) => (
                  <li key={f.name} className="text-zinc-300">
                    <span className="font-mono">{f.name}</span>
                    <span className="text-zinc-500"> · {f.type}</span>
                    {f.required ? <span className="ml-1 text-red-400">*</span> : null}
                    <span className="ml-2 text-zinc-400">{f.label}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {skill.tags.length > 0 ? (
            <div>
              <p className="mb-1 text-zinc-400">Tags</p>
              <div className="flex gap-1">
                {skill.tags.map((t) => (
                  <span key={t} className="rounded bg-zinc-800 px-1.5 py-0.5 text-zinc-300">{t}</span>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
