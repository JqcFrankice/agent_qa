import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { login, ApiError } from "../lib/api.js";
import { Form } from "../components/Form.js";

export function LoginPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: login,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["me"] });
      navigate("/home");
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "登录失败")
  });

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    mutation.mutate({ username: String(form.get("username")), password: String(form.get("password")) });
  }

  return (
    <Form title="登录" submitLabel="登录" error={error} onSubmit={onSubmit}>
      <input name="username" className="rounded border border-zinc-700 bg-zinc-900 px-3 py-2" placeholder="用户名" />
      <input name="password" className="rounded border border-zinc-700 bg-zinc-900 px-3 py-2" placeholder="密码" type="password" />
      <Link className="text-sm text-blue-400" to="/register">没有账号？注册</Link>
    </Form>
  );
}
