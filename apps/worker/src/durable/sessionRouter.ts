import {
  matchSessionRoute,
  type SessionRouteName,
} from '../pure/sessionRouteMatch.js';

export type {SessionRouteName};
export {matchSessionRoute};

export async function dispatchSessionRoute(
  request: Request,
  handlers: Record<
    SessionRouteName,
    (request: Request) => Promise<Response> | Response
  >
): Promise<Response | undefined> {
  const route = matchSessionRoute(request);
  if (!route) return undefined;
  return await handlers[route](request);
}
