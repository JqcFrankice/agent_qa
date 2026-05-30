import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Navigate } from "react-router-dom";
import { logout, me } from "../lib/api.js";

export function HomePage() {
  const queryClient = useQueryClient();
  const { data, isLoading, isError } = useQuery({ queryKey: ["me"], queryFn: me });
  const mutation = useMutation({
    mutationFn: logout,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["me"] });
    }
  });

  if (isLoading) return <main className="p-8">加载中...</main>;
  if (isError || !data) return <Navigate to="/login" replace />;

  return (
    <main className="mx-auto mt-24 max-w-xl rounded-xl border border-zinc-800 bg-zinc-950 p-6">
      <h1 className="text-2xl font-semibold">Hello {data.user.username}</h1>
      <p className="mt-2 text-zinc-400">账号系统已就绪。</p>
      <button className="mt-6 rounded bg-zinc-800 px-4 py-2 hover:bg-zinc-700" onClick={() => mutation.mutate()}>
        登出
      </button>
    </main>
  );
}
