export type RealtimeEvent = { event: string; payload: any };

export function connectRealtime(onEvent: (e: RealtimeEvent) => void): () => void {
  let ws: WebSocket | null = null;
  let closed = false;
  let retry: ReturnType<typeof setTimeout>;

  const open = () => {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    ws = new WebSocket(`${proto}://${location.host}/ws`);
    ws.onmessage = (m) => {
      try {
        onEvent(JSON.parse(m.data));
      } catch {
        /* ignore */
      }
    };
    ws.onclose = () => {
      if (!closed) retry = setTimeout(open, 2500);
    };
    ws.onerror = () => ws?.close();
  };

  open();
  return () => {
    closed = true;
    clearTimeout(retry);
    ws?.close();
  };
}
