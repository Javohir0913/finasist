import { ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import { Spinner } from "./components/ui";
import Closing from "./pages/Closing";
import Dashboard from "./pages/Dashboard";
import Directories from "./pages/Directories";
import Exchange from "./pages/Exchange";
import Inventory from "./pages/Inventory";
import Ledgers from "./pages/Ledgers";
import Loans from "./pages/Loans";
import Login from "./pages/Login";
import Materials from "./pages/Materials";
import Organizations from "./pages/Organizations";
import Payroll from "./pages/Payroll";
import Products from "./pages/Products";
import Reports from "./pages/Reports";
import Roles from "./pages/Roles";
import Services from "./pages/Services";
import Settings from "./pages/Settings";
import Taxes from "./pages/Taxes";
import Transactions from "./pages/Transactions";
import Users from "./pages/Users";
import { LockProvider } from "./lib/lock";
import { PeriodProvider } from "./lib/period";
import { useAuth } from "./store/auth";
import { RealtimeProvider } from "./store/realtime";

function Denied() {
  return (
    <div className="grid place-items-center py-32 text-center">
      <div>
        <div className="text-5xl mb-4 opacity-30">🔒</div>
        <h2 className="text-xl font-bold text-ink">Доступ запрещён</h2>
        <p className="text-slate-400 mt-2 max-w-sm">
          У вас нет прав на этот раздел. Обратитесь к супер-администратору для назначения роли.
        </p>
      </div>
    </div>
  );
}

function Guard({ perm, children }: { perm: string; children: ReactNode }) {
  const { can } = useAuth();
  return can(perm) ? <>{children}</> : <Denied />;
}

export default function App() {
  const { user, loading } = useAuth();

  if (loading) return <Spinner />;
  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <RealtimeProvider>
      <LockProvider>
      <PeriodProvider>
      <Routes>
        <Route path="/login" element={<Navigate to="/" replace />} />
        <Route
          path="*"
          element={
            <Layout>
              <Routes>
                <Route path="/" element={<Guard perm="dashboard:view"><Dashboard /></Guard>} />
                <Route path="/reports" element={<Guard perm="reports:view"><Reports /></Guard>} />
                <Route path="/ledgers" element={<Guard perm="reports:view"><Ledgers /></Guard>} />
                <Route path="/closing" element={<Guard perm="closing:view"><Closing /></Guard>} />
                <Route path="/directories" element={<Guard perm="articles:view"><Directories /></Guard>} />
                <Route path="/transactions" element={<Guard perm="transactions:view"><Transactions /></Guard>} />
                <Route path="/organizations" element={<Guard perm="organizations:view"><Organizations /></Guard>} />
                <Route path="/taxes" element={<Guard perm="taxes:view"><Taxes /></Guard>} />
                <Route path="/loans" element={<Guard perm="loans:view"><Loans /></Guard>} />
                <Route path="/services" element={<Guard perm="services:view"><Services /></Guard>} />
                <Route path="/exchange" element={<Guard perm="exchange:view"><Exchange /></Guard>} />
                <Route path="/inventory" element={<Guard perm="materials:view"><Inventory /></Guard>} />
                <Route path="/products" element={<Guard perm="products:view"><Products /></Guard>} />
                <Route path="/materials" element={<Guard perm="materials:view"><Materials /></Guard>} />
                <Route path="/payroll" element={<Guard perm="payroll:view"><Payroll /></Guard>} />
                <Route path="/users" element={<Guard perm="users:view"><Users /></Guard>} />
                <Route path="/roles" element={<Guard perm="roles:view"><Roles /></Guard>} />
                <Route path="/settings" element={<Guard perm="settings:view"><Settings /></Guard>} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Layout>
          }
        />
      </Routes>
      </PeriodProvider>
      </LockProvider>
    </RealtimeProvider>
  );
}
