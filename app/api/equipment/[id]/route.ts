import { withAuth, ok } from '@/lib/auth/withAuth';
import { EDITORS } from '@/lib/permissions';
import { getEquipment, updateEquipment } from '@/lib/services/equipment';
import { assertUuid, defined, parseBody, readJson } from '@/lib/services/core/validate';
import { updateSchema } from '../schema';

export const GET = withAuth(async (_req, { requestId, params }) =>
  ok(await getEquipment(assertUuid(params.id)), requestId));

export const PUT = withAuth(async (req, { requestId, profile, params }) => {
  const body = defined(parseBody(updateSchema, await readJson(req)));
  return ok(await updateEquipment(assertUuid(params.id), body, profile.id), requestId);
}, { role: EDITORS });
