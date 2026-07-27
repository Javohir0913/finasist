import { ReactNode } from "react";

const I = (d: string) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);

export const icons = {
  dashboard: I("M4 13h6V4H4v9Zm0 7h6v-5H4v5Zm10 0h6V11h-6v9Zm0-16v5h6V4h-6Z"),
  org: I("M3 21h18M5 21V7l7-4 7 4v14M9 9h.01M9 13h.01M9 17h.01M15 9h.01M15 13h.01M15 17h.01"),
  counter: I("M4 5h16M4 5v14M4 19h16M20 5v14M8 9l3 3-3 3M13 15h4"),
  tx: I("M3 7h13l-3-3M21 17H8l3 3M3 12h18"),
  product: I("M21 16V8l-9-5-9 5v8l9 5 9-5ZM3.3 7L12 12l8.7-5M12 22V12"),
  material: I("M20 7 12 3 4 7v10l8 4 8-4V7ZM4 7l8 4 8-4M12 21v-10"),
  tax: I("M9 7h6M9 11h6M9 15h4M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"),
  loan: I("M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"),
  exchange: I("M17 1l4 4-4 4M3 11V9a4 4 0 0 1 4-4h14M7 23l-4-4 4-4M21 13v2a4 4 0 0 1-4 4H3"),
  report: I("M3 3v18h18M18 17V9M13 17V5M8 17v-3"),
  users: I("M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM23 21v-2a4 4 0 0 0-3-3.87M16 3.13A4 4 0 0 1 16 11"),
  roles: I("M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10ZM9 12l2 2 4-4"),
};

export interface NavItem {
  to: string;
  label: string;
  perm: string;
  icon: ReactNode;
  group: string;
}

export const NAV: NavItem[] = [
  { to: "/", label: "Дашборд", perm: "dashboard:view", icon: icons.dashboard, group: "Обзор" },
  { to: "/reports", label: "Отчёты", perm: "reports:view", icon: icons.report, group: "Обзор" },
  { to: "/transactions", label: "Банк и Касса", perm: "transactions:view", icon: icons.tx, group: "Финансы" },
  { to: "/organizations", label: "Организации", perm: "organizations:view", icon: icons.org, group: "Финансы" },
  { to: "/directories", label: "Справочники", perm: "articles:view", icon: icons.counter, group: "Финансы" },
  { to: "/taxes", label: "Налоги", perm: "taxes:view", icon: icons.tax, group: "Финансы" },
  { to: "/loans", label: "Займы", perm: "loans:view", icon: icons.loan, group: "Финансы" },
  { to: "/services", label: "Услуги", perm: "services:view", icon: icons.counter, group: "Финансы" },
  { to: "/exchange", label: "Курс доллара", perm: "exchange:view", icon: icons.exchange, group: "Финансы" },
  { to: "/inventory", label: "Склад и производство", perm: "materials:view", icon: icons.material, group: "Склад" },
  { to: "/products", label: "Готовая продукция", perm: "products:view", icon: icons.product, group: "Склад" },
  { to: "/materials", label: "Справочник сырья", perm: "materials:view", icon: icons.counter, group: "Склад" },
  { to: "/payroll", label: "Зарплата", perm: "payroll:view", icon: icons.users, group: "Персонал" },
  { to: "/users", label: "Пользователи", perm: "users:view", icon: icons.users, group: "Администрирование" },
  { to: "/roles", label: "Роли и доступы", perm: "roles:view", icon: icons.roles, group: "Администрирование" },
  { to: "/settings", label: "Настройки", perm: "settings:view", icon: icons.counter, group: "Администрирование" },
];
