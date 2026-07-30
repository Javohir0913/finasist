import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiError } from "../api/client";
import { useAuth } from "../store/auth";

export default function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr("");
    setLoading(true);
    try {
      await login(email, password);
      nav("/");
    } catch (e) {
      setErr(apiError(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      {/* Left brand panel */}
      <div className="relative hidden lg:flex flex-col justify-between p-12 overflow-hidden border-r border-line">
        <div className="absolute inset-0 bg-grid-faint [background-size:44px_44px] opacity-40" />
        <div className="absolute -top-32 -left-20 h-96 w-96 rounded-full bg-accent/20 blur-3xl" />
        <div className="absolute bottom-0 right-0 h-96 w-96 rounded-full bg-violet2/15 blur-3xl" />
        <div className="relative flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-accent to-violet2 grid place-items-center font-black text-white shadow-glow">P</div>
          <div className="font-bold text-white tracking-tight">PROFIT DIVIDER</div>
        </div>
        <div className="relative">
          <h1 className="text-4xl font-extrabold text-white leading-tight tracking-tight">
            Финансовая платформа <br /> нового поколения
          </h1>
          <p className="mt-4 text-slate-400 max-w-md">
            Реальное движение денег, дебиторка и кредиторка, склад и производство — в едином защищённом контуре
            с гибким управлением доступами.
          </p>
          <div className="mt-8 flex gap-6 text-sm">
            <div><div className="text-2xl font-bold text-white">Real-time</div><div className="text-slate-500">обновления</div></div>
            <div><div className="text-2xl font-bold text-white">RBAC</div><div className="text-slate-500">контроль доступа</div></div>
            <div><div className="text-2xl font-bold text-white">USD/UZS</div><div className="text-slate-500">мультивалюта</div></div>
          </div>
        </div>
        <div className="relative text-xs text-slate-600">© 2025 PROFIT DIVIDER · Все права защищены</div>
      </div>

      {/* Right form */}
      <div className="flex items-center justify-center p-6">
        <form onSubmit={submit} className="w-full max-w-sm glass p-8">
          <h2 className="text-2xl font-bold text-white">Вход в систему</h2>
          <p className="text-sm text-slate-400 mt-1 mb-6">Введите учётные данные для продолжения</p>

          {err && <div className="mb-4 rounded-xl bg-rose-500/12 border border-rose-500/25 text-rose-300 text-sm px-3.5 py-2.5">{err}</div>}

          <div className="space-y-4">
            <div>
              <label className="label">Email</label>
              <input className="input" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
            </div>
            <div>
              <label className="label">Пароль</label>
              <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
            </div>
          </div>

          <button className="btn-primary w-full mt-6" disabled={loading || !email || !password}>
            {loading ? "Вход…" : "Войти"}
          </button>
        </form>
      </div>
    </div>
  );
}
