import { useQuery } from "@tanstack/react-query";
import { Navigate, Route, Routes } from "react-router-dom";
import { me } from "./lib/api.js";
import { HomePage } from "./routes/home.js";
import { LoginPage } from "./routes/login.js";
import { RegisterPage } from "./routes/register.js";

function RootRedirect() {
  const { data, isLoading } = useQuery({ queryKey: ["me"], queryFn: me, retry: false });
  if (isLoading) return <main className="p-8">加载中...</main>;
  return <Navigate to={data ? "/home" : "/login"} replace />;
}

export function App() {
  return (
    <Routes>
      <Route path="/" element={<RootRedirect />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/home" element={<HomePage />} />
    </Routes>
  );
}
