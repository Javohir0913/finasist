import { useEffect, useState } from "react";
import api, { apiError } from "../api/client";
import { Modal } from "./ui";

interface Result {
  applied: boolean;
  total: number;
  ok: number;
  failed: number;
  message: string;
  errors: { row: number; error: string }[];
  preview: { row: number; summary: string }[];
}

const LABELS: Record<string, string> = {
  transactions: "операций (БАНК / КАССА)",
  receipts: "прихода сырья и запчастей",
  sales: "продажи готовой продукции",
};

/**
 * Загрузка данных из .xlsx. Сначала всегда проверка (dry-run): файл с ошибками
 * не записывается — пользователь видит номера строк и что именно не так.
 */
export default function ImportModal({
  kind,
  open,
  onClose,
  onDone,
}: {
  kind: keyof typeof LABELS | string;
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [res, setRes] = useState<Result | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const { data: templates } = useTemplates(open);
  const tpl = templates?.find((t: any) => t.key === kind);

  const send = async (dry: boolean) => {
    if (!file) return;
    setBusy(true);
    setErr("");
    const fd = new FormData();
    fd.append("file", file);
    try {
      const r = await api.post<Result>(`/import/${kind}?dry_run=${dry}`, fd);
      setRes(r.data);
      if (r.data.applied) onDone();
    } catch (e) {
      setErr(apiError(e));
    } finally {
      setBusy(false);
    }
  };

  const close = () => {
    setFile(null);
    setRes(null);
    setErr("");
    onClose();
  };

  return (
    <Modal open={open} onClose={close} title={`Загрузка ${LABELS[kind] || kind} из Excel`} width="max-w-2xl">
      {err && <div className="mb-4 rounded-xl bg-rose-500/12 border border-rose-500/25 text-rose-300 text-sm px-3.5 py-2.5">{err}</div>}

      {tpl && (
        <div className="mb-4 rounded-xl bg-white/[0.03] border border-line p-3.5">
          <div className="text-sm font-semibold text-white mb-1.5">Ожидаемые колонки первой строки</div>
          <div className="flex flex-wrap gap-1.5">
            {tpl.columns.map((c: string) => (
              <span key={c} className="chip bg-white/5 text-slate-400 border border-line text-[11px]">{c}</span>
            ))}
          </div>
          <p className="text-xs text-slate-500 mt-2">
            Порядок колонок не важен, лишние игнорируются. Звёздочка — обязательное поле.
            Контрагенты, сырьё и продукция подбираются по ИНН/коду/названию из справочников.
          </p>
        </div>
      )}

      <input
        type="file"
        accept=".xlsx,.xlsm"
        className="input"
        onChange={(e) => {
          setFile(e.target.files?.[0] || null);
          setRes(null);
        }}
      />

      {res && (
        <div className="mt-4">
          <div
            className={`rounded-xl px-3.5 py-2.5 text-sm border ${
              res.applied
                ? "bg-emerald-500/12 border-emerald-500/25 text-emerald-300"
                : res.failed
                ? "bg-rose-500/12 border-rose-500/25 text-rose-300"
                : "bg-accent/12 border-accent/25 text-accent-soft"
            }`}
          >
            {res.message} — строк: {res.total}, готовы: {res.ok}, с ошибками: {res.failed}
          </div>

          {res.errors.length > 0 && (
            <div className="mt-3 max-h-48 overflow-auto rounded-xl border border-line">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-base-850">
                  <tr><th className="th w-20">Строка</th><th className="th">Что не так</th></tr>
                </thead>
                <tbody>
                  {res.errors.map((e) => (
                    <tr key={e.row}><td className="td text-slate-400">{e.row}</td><td className="td text-rose-300">{e.error}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {!res.applied && !res.failed && res.preview.length > 0 && (
            <div className="mt-3 max-h-48 overflow-auto rounded-xl border border-line">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-base-850">
                  <tr><th className="th w-20">Строка</th><th className="th">Будет создано</th></tr>
                </thead>
                <tbody>
                  {res.preview.map((p) => (
                    <tr key={p.row}><td className="td text-slate-400">{p.row}</td><td className="td text-slate-300">{p.summary}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <div className="flex justify-end gap-2 mt-6">
        <button className="btn-ghost" onClick={close}>Закрыть</button>
        <button className="btn-ghost" onClick={() => send(true)} disabled={!file || busy}>
          {busy ? "…" : "Проверить файл"}
        </button>
        <button
          className="btn-primary"
          onClick={() => send(false)}
          disabled={!file || busy || !res || res.failed > 0 || res.applied}
          title={!res ? "Сначала проверьте файл" : undefined}
        >
          {busy ? "Загрузка…" : "Загрузить"}
        </button>
      </div>
    </Modal>
  );
}

function useTemplates(enabled: boolean) {
  const [data, setData] = useState<any[] | null>(null);
  useEffect(() => {
    if (!enabled || data) return;
    let alive = true;
    api
      .get("/import/templates")
      .then((r) => alive && setData(r.data))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [enabled, data]);
  return { data };
}
