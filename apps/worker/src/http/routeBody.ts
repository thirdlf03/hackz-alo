import type {WorkerContext} from './context.js';
import {
  readJsonBody,
  readJsonObjectBody,
  readRequestBody,
  requestBodyErrorResponse,
} from './body.js';

export async function readRouteRequestBody(
  c: WorkerContext,
  maxBytes: number
): Promise<ArrayBuffer | Response> {
  try {
    return await readRequestBody(c.req.raw, maxBytes);
  } catch (error) {
    return requestBodyErrorResponse(c, error);
  }
}

export async function readRouteJsonBody(
  c: WorkerContext,
  maxBytes: number,
  options: {emptyValue?: unknown} = {}
) {
  try {
    return await readJsonBody(c.req.raw, maxBytes, options);
  } catch (error) {
    return requestBodyErrorResponse(c, error);
  }
}

export async function readRouteJsonObject(
  c: WorkerContext,
  maxBytes: number,
  options: {emptyValue?: Record<string, unknown>} = {}
): Promise<Record<string, unknown> | Response> {
  try {
    return await readJsonObjectBody(c.req.raw, maxBytes, options);
  } catch (error) {
    return requestBodyErrorResponse(c, error);
  }
}
