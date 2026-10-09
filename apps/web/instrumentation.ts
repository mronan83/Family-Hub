import type { Instrumentation } from 'next';
import { householdOfRequest, recordAppError } from './lib/errors';

// [NFR-07] Every unhandled server error (pages, route handlers, server actions) is logged with its
// request id and kept in private.app_error, without request bodies or PII (US-904), under the
// household of whoever made the request, for that household's System Health page (D-42).
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  const id = request.headers['x-vercel-id'];
  await recordAppError({
    requestId: Array.isArray(id) ? id[0] : id,
    method: request.method,
    route: context.routePath,
    kind: context.routeType,
    error,
    householdId: await householdOfRequest(request.headers),
  });
};
