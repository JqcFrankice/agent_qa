import { useMutation } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ApiError, register } from "../lib/api.js";
import { Form } from "../components/Form.js";
import { TurnstileWidget } from "../components/TurnstileWidget.js";

export function RegisterPage() {
  const navigate = useNavigate();
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: register,
    onSuccess: () => navigate("/login"),
    onError: (err) => setError(err instanceof ApiError ? err.message : "注册失败")
  });

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    mutation.mutate({
      username: String(form.get("username")),
      password: String(form.get("password")),
      inviteCode: String(form.get("inviteCode")),
      turnstileToken: token
    });
  }

  return (
    <Form title="注册" submitLabel="注册" error={error} onSubmit={onSubmit}>
      <input name="username" className="rounded border border-zinc-700 bg-zinc-900 px-3 py-2" placeholder="用户名" />
      <input name="password" className="rounded border border-zinc-700 bg-zinc-900 px-3 py-2" placeholder="密码" type="password" />
      <input name="inviteCode" className="rounded border border-zinc-700 bg-zinc-900 px-3 py-2" placeholder="邀请码" />
      <TurnstileWidget siteKey={import.meta.env.VITE_TURNSTILE_SITE_KEY ?? "dev"} onToken={setToken} />
      <Link className="text-sm text-blue-400" to="/login">已有账号？登录</Link>
    </Form>
  );
}
