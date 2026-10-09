import type { Instrumentation } from 'next';
import { recordAppError } from './lib/errors';

// [NFR-07] Every unhandled server error (pages, route handlers, server actions) is logged with its
// request id and kept in private.app_error, without request bodies or PII (US-904).
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  const id = request.headers['x-vercel-id'];
  await recordAppError({
    requestId: Array.isArray(id) ? id[0] : id,
    method: request.method,
    route: context.routePath,
    kind: context.routeType,
    error,
  });
};
