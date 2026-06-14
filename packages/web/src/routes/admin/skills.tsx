import { useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";
import { me } from "../../lib/api.js";
import { listAdminSkills, approveSkill, rejectSkill } from "../../lib/admin.js";
import { Button } from "../../components/ui/button.js";
import { Skeleton } from "../../components/ui/skeleton.js";
import { AdminSkillRow } from "./AdminSkillRow.js";
import { RejectReasonDialog } from "./RejectReasonDialog.js";

type Status = "pending" | "approved" | "rejected";

export function AdminSkillsPage() {
  const queryClient = useQueryClient();
  const meQuery = useQuery({ queryKey: ["me"], queryFn: me, retry: false });
  const [status, setStatus] = useState<Status>("pending");
  const [rejectingId, setRejectingId] = useState<number | null>(null);

  const skillsQuery = useQuery({
    queryKey: ["admin-skills", status],
    queryFn: () => listAdminSkills(status),
    enabled: meQuery.data?.user.role === "admin"
  });

  const approveMutation = useMutation({
    mutationFn: approveSkill,
    onSuccess: () => {
      toast.success("已通过");
      void queryClient.invalidateQueries({ queryKey: ["admin-skills"] });
      void queryClient.invalidateQueries({ queryKey: ["skills"] });
    },
    onError: () => toast.error("操作失败")
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) => rejectSkill(id, reason),
    onSuccess: () => {
      toast.success("已拒绝");
      setRejectingId(null);
      void queryClient.invalidateQueries({ queryKey: ["admin-skills"] });
      void queryClient.invalidateQueries({ queryKey: ["skills"] });
    },
    onError: () => toast.error("操作失败")
  });

  if (meQuery.isLoading) return <main className="p-8 text-zinc-100">加载中...</main>;
  if (meQuery.isError || !meQuery.data) return <Navigate to="/login" replace />;
  if (meQuery.data.user.role !== "admin") return <Navigate to="/chat" replace />;

  const skills = skillsQuery.data?.skills ?? [];

  return (
    <div className="min-h-screen bg-zinc-900 text-zinc-100">
      <div className="mx-auto max-w-3xl p-6">
        <div className="mb-4 flex items-center gap-3">
          <Link to="/chat" className="text-zinc-400 hover:text-zinc-200" aria-label="返回">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <h1 className="text-lg font-semibold">Skill 审核</h1>
        </div>

        <div className="mb-3 flex gap-1">
          {(["pending", "approved", "rejected"] as Status[]).map((s) => (
            <Button
              key={s}
              variant={status === s ? "default" : "ghost"}
              size="sm"
              onClick={() => setStatus(s)}
            >
              {s === "pending" ? "待审" : s === "approved" ? "已通过" : "被拒"}
            </Button>
          ))}
        </div>

        {skillsQuery.isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : skills.length === 0 ? (
          <p className="py-8 text-center text-sm text-zinc-500">
            {status === "pending" ? "没有待审 skill" : status === "approved" ? "没有已通过 skill" : "没有被拒 skill"}
          </p>
        ) : (
          <div className="space-y-2">
            {skills.map((skill) => (
              <AdminSkillRow
                key={skill.id}
                skill={skill}
                onApprove={() => approveMutation.mutate(skill.id)}
                onReject={() => setRejectingId(skill.id)}
                busy={approveMutation.isPending || rejectMutation.isPending}
              />
            ))}
          </div>
        )}
      </div>

      <RejectReasonDialog
        open={rejectingId !== null}
        onOpenChange={(v) => { if (!v) setRejectingId(null); }}
        isSubmitting={rejectMutation.isPending}
        onSubmit={(reason) => {
          if (rejectingId !== null) rejectMutation.mutate({ id: rejectingId, reason });
        }}
      />
    </div>
  );
}
