import { withAuth, ok } from '@/lib/auth/withAuth';
import { AppError } from '@/lib/errors';
import { isSameOriginRequest } from '@/lib/auth/requestOrigin';
import { loginWithUsername } from '@/lib/services/login';

export const POST = withAuth(async (req, { requestId }) => {
  if (!isSameOriginRequest(req)) throw new AppError('FORBIDDEN');
  const text = await req.text();
  if (text.length > 4096) throw new AppError('INVALID_CREDENTIALS');
  let input;
  try { input = JSON.parse(text); } catch { throw new AppError('INVALID_CREDENTIALS'); }
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new AppError('INVALID_CREDENTIALS');
  await loginWithUsername(input);
  const response = ok({ signed_in: true }, requestId);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}, { allowAnonymous: true });
