import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { SkillDto } from "@server-agent/shared";
import { deleteSkill, listSkills, updateSkill } from "../../lib/skills.js";
import { Skeleton } from "../../components/ui/skeleton.js";
import { SkillItem } from "./SkillItem.js";

interface SkillsPanelProps {
  onUseSkill: (skill: SkillDto) => void;
  onEditSkill: (skill: SkillDto) => void;
}

export function SkillsPanel({ onUseSkill, onEditSkill }: SkillsPanelProps) {
  const queryClient = useQueryClient();
  const skillsQuery = useQuery({ queryKey: ["skills"], queryFn: listSkills });

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

  if (skillsQuery.isLoading) {
    return (
      <div className="space-y-2 px-1">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
      </div>
    );
  }

  const skills = skillsQuery.data?.skills ?? [];
  if (skills.length === 0) {
    return (
      <p className="px-2 py-4 text-sm text-zinc-500">
        还没有 Skill。在对话里点「保存为 Skill」试试。
      </p>
    );
  }

  return (
    <div className="space-y-1 px-1">
      {skills.map((skill) => (
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
  );
}
