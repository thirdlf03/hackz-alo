import type {Context, Hono} from 'hono';
import type {Bindings} from '../types.js';

export type WorkerApp = Hono<{Bindings: Bindings}>;
export type WorkerContext = Context<{Bindings: Bindings}>;
