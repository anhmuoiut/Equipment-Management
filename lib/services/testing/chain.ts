/**
 * Giả một chuỗi truy vấn kiểu Supabase (`from().select().eq().order()…`) cho bài test: mọi phương thức trả lại chính nó
 * và ghi lại lời gọi; `await` chuỗi cho kết quả đã định ({ data, error, count }).
 */
export type ChainResult = { data?: unknown; error?: unknown; count?: number | null };

export function chain(result: ChainResult = { data: [], error: null }) {
  const calls: [string, unknown[]][] = [];
  const proxy: unknown = new Proxy({}, {
    get(_target, prop) {
      if (prop === 'then') return (resolve: (v: unknown) => void) => resolve({ error: null, ...result });
      return (...args: unknown[]) => { calls.push([String(prop), args]); return proxy; };
    },
  });
  return { proxy: proxy as never, calls, names: () => calls.map(([name]) => name), call: (name: string) => calls.find(([n]) => n === name)?.[1] };
}
