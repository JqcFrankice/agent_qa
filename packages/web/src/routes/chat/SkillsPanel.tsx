import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { SkillDto } from "@server-agent/shared";
import { deleteSkill, listSkills, updateSkill } from "../../lib/skills.js";
import { Button } from "../../components/ui/button.js";
import { Skeleton } from "../../components/ui/skeleton.js";
import { SkillItem } from "./SkillItem.js";

interface SkillsPanelProps {
  onUseSkill: (skill: SkillDto) => void;
  onEditSkill: (skill: SkillDto) => void;
}

const ALL_TAG = "__all__";
const MAX_CHIPS = 6;

export function SkillsPanel({ onUseSkill, onEditSkill }: SkillsPanelProps) {
  const queryClient = useQueryClient();
  const skillsQuery = useQuery({ queryKey: ["skills"], queryFn: listSkills });
  const [activeTag, setActiveTag] = useState<string>(ALL_TAG);

  const togglePublic = useMutation({
    mutationFn: ({ skill }: { skill: SkillDto }) =>
      updateSkill(skill.id, { isPublic: !skill.isPublic }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["skills"] }),
    onError: () => toast.error("操作失败")
  });

  const removeSkill = useMutation({
    mutationFn: (id: number) => deleteSkill(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["skills"] }),
    onError: () => toast.error("删除失败")
  });

  const skills = skillsQuery.data?.skills ?? [];

  const topTags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of skills) for (const t of s.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_CHIPS).map(([t]) => t);
  }, [skills]);

  const filtered = useMemo(() => {
    if (activeTag === ALL_TAG) return skills;
    return skills.filter((s) => s.tags.includes(activeTag));
  }, [skills, activeTag]);

  if (skillsQuery.isLoading) {
    return (
      <div className="space-y-2 px-1">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
      </div>
    );
  }

  if (skills.length === 0) {
    return (
      <p className="px-2 py-4 text-sm text-zinc-500">
        还没有 Skill。在对话里点「保存为 Skill」试试。
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {topTags.length > 0 ? (
        <div className="flex flex-wrap gap-1 px-1">
          <Button
            variant={activeTag === ALL_TAG ? "default" : "ghost"}
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={() => setActiveTag(ALL_TAG)}
          >
            全部
          </Button>
          {topTags.map((tag) => (
            <Button
              key={tag}
              variant={activeTag === tag ? "default" : "ghost"}
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={() => setActiveTag(tag)}
            >
              {tag}
            </Button>
          ))}
        </div>
      ) : null}

      {filtered.length === 0 ? (
        <p className="px-2 py-4 text-sm text-zinc-500">该 tag 下没有 Skill</p>
      ) : (
        <div className="space-y-1 px-1">
          {filtered.map((skill) => (
            <SkillItem
              key={skill.id}
              skill={skill}
              onUse={() => onUseSkill(skill)}
              onEdit={() => onEditSkill(skill)}
              onDelete={() => {
                if (window.confirm(`确认删除 "${skill.title}"？`)) removeSkill.mutate(skill.id);
              }}
              onTogglePublic={() => togglePublic.mutate({ skill })}
            />
          ))}
        </div>
      )}
    </div>
  );
}
