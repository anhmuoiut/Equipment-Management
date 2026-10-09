import { withAuth, ok } from '@/lib/auth/withAuth';
import { getDashboard } from '@/lib/services/dashboard';

export const GET = withAuth(async (_req, { requestId }) => ok(await getDashboard(), requestId));
