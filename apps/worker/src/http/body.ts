import type {WorkerContext} from './context.js';
import {err, HttpError} from './response.js';

export class RequestBodyError extends Error {
  constructor(
    readonly status: 400 | 413,
    readonly code: 'bad_request' | 'payload_too_large',
    message: string
  ) {
    super(message);
  }
}

export async function readRequestBody(
  request: Request,
  maxBytes: number
): Promise<ArrayBuffer> {
  const contentLength = request.headers.get('content-length');
  if (contentLength) {
    const size = Number.parseInt(contentLength, 10);
    if (Number.isFinite(size) && size > maxBytes) {
      throw new RequestBodyError(
        413,
        'payload_too_large',
        'request body too large'
      );
    }
  }
  if (!request.body) return new ArrayBuffer(0);

  const reader =
    request.body.getReader() as ReadableStreamDefaultReader<Uint8Array>;
  const chunks: Uint8Array[] = [];
  let total = 0;
  let readResult = await reader.read();
  while (!readResult.done) {
    const value = readResult.value;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new RequestBodyError(
        413,
        'payload_too_large',
        'request body too large'
      );
    }
    chunks.push(value);
    readResult = await reader.read();
  }
  return concatenateChunks(chunks, total);
}

export async function readJsonBody(
  request: Request,
  maxBytes: number,
  options: {emptyValue?: unknown} = {}
) {
  const body = await readRequestBody(request, maxBytes);
  const text = new TextDecoder().decode(body).trim();
  if (!text) {
    if ('emptyValue' in options) return options.emptyValue;
    throw new RequestBodyError(400, 'bad_request', 'request body is required');
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new RequestBodyError(400, 'bad_request', 'invalid json body');
  }
}

export async function readJsonObjectBody(
  request: Request,
  maxBytes: number,
  options: {emptyValue?: Record<string, unknown>} = {}
): Promise<Record<string, unknown>> {
  const value = await readJsonBody(request, maxBytes, options);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new RequestBodyError(
      400,
      'bad_request',
      'request body must be a json object'
    );
  }
  return value as Record<string, unknown>;
}

/**
 * Durable Object variant of `readJsonObjectBody`: body errors surface
 * as `HttpError` so the DO error middleware turns them into JSON
 * responses. An empty body reads as `{}`.
 */
export async function readInternalJsonObject(
  request: Request,
  maxBytes: number
): Promise<Record<string, unknown>> {
  try {
    return await readJsonObjectBody(request, maxBytes, {emptyValue: {}});
  } catch (error) {
    if (error instanceof RequestBodyError) {
      throw new HttpError(error.status, error.code, error.message);
    }
    throw error;
  }
}

export function requestBodyErrorResponse(
  c: WorkerContext,
  error: unknown
): Response {
  if (error instanceof RequestBodyError) {
    return c.json(err(error.code, error.message), error.status);
  }
  throw error;
}

function concatenateChunks(chunks: Uint8Array[], total: number) {
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output.buffer;
}
