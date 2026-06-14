import { useQuery } from "@tanstack/react-query";
import { Navigate, Route, Routes } from "react-router-dom";
import { Toaster } from "sonner";
import { me } from "./lib/api.js";
import { ChatPage } from "./routes/chat/index.js";
import { LoginPage } from "./routes/login.js";
import { RegisterPage } from "./routes/register.js";
import { AdminSkillsPage } from "./routes/admin/skills.js";

function RootRedirect() {
  const { data, isLoading } = useQuery({ queryKey: ["me"], queryFn: me, retry: false });
  if (isLoading) return <main className="p-8">加载中...</main>;
  return <Navigate to={data ? "/chat" : "/login"} replace />;
}

export function App() {
  return (
    <>
      <Routes>
        <Route path="/" element={<RootRedirect />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/home" element={<Navigate to="/chat" replace />} />
        <Route path="/chat" element={<ChatPage />} />
        <Route path="/admin/skills" element={<AdminSkillsPage />} />
      </Routes>
      <Toaster theme="dark" position="top-center" />
    </>
  );
}
