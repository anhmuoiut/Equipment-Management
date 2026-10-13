/** Compare with the incoming host: Next.js may normalize req.url to localhost. */
export function isSameOriginRequest(req: { url: string; headers: Headers }): boolean {
  const origin = req.headers.get('origin');
  if (!origin) return true;
  try {
    const requestUrl = new URL(req.url);
    const host = req.headers.get('host') ?? requestUrl.host;
    return origin === new URL(requestUrl.protocol + '//' + host).origin;
  } catch {
    return false;
  }
}
