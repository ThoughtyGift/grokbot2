/**
 * Client for the box exec daemon. Lives in this process so the BFF never shells out to the box
 * when `GROKBOT2_COMPUTER_URL` is set (ROADMAP §5.5).
 */
const BASE = (): string => process.env.GROKBOT2_BOX_EXEC_URL ?? "";
const TOKEN = (): string => process.env.GROKBOT2_EXEC_TOKEN ?? "";
const TIMEOUT_MS = (): number => Number(process.env.GROKBOT2_BOX_TIMEOUT_MS ?? 90_000);

export class BoxUnavailable extends Error {}

export async function daemonCall<T = unknown>(op: string, args: Record<string, unknown> = {}, owner = ""): Promise<T> {
  const base = BASE();
  if (!base) {
    throw new BoxUnavailable(
      "Chưa nối box: đặt GROKBOT2_BOX_EXEC_URL (và GROKBOT2_EXEC_TOKEN) trên process computer.",
    );
  }
  const timeout = TIMEOUT_MS();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  try {
    const res = await fetch(`${base.replace(/\/+$/, "")}/${op}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(TOKEN() ? { authorization: `Bearer ${TOKEN()}` } : {}),
        // Chặng cuối của danh tính. Rỗng thì KHÔNG gửi, để box báo lỗi rõ ràng thay vì nhận một
        // header rỗng rồi đoán — `osUserFor` trong exec-router cố ý ném khi không có owner, và
        // đoán ở đây sẽ biến một lỗi cách ly thành một lỗi im lặng.
        ...(owner ? { "x-grokbot2-owner": owner } : {}),
      },
      body: JSON.stringify(args),
      signal: ctl.signal,
    });
    if (!res.ok) throw new BoxUnavailable(`box ${op} -> HTTP ${res.status}`);
    const json = (await res.json()) as T & { error?: string };
    if (json && typeof json === "object" && "error" in json && json.error) throw new Error(String(json.error));
    return json;
  } catch (e) {
    if (e instanceof BoxUnavailable) throw e;
    if ((e as Error)?.name === "AbortError") throw new BoxUnavailable(`box ${op} quá ${timeout}ms không phản hồi`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
