export interface SessionSseHubDependencies {
  loadSnapshot(): Promise<unknown>;
  loadReplayBuffer(): Promise<unknown[]>;
  loadExerciseSnapshot?: () => Promise<unknown>;
  touchClientActivity(): Promise<void>;
  onClientClose(): Promise<void>;
}

export class SessionSseHub {
  private clients = new Set<ReadableStreamDefaultController<Uint8Array>>();
  private encoder = new TextEncoder();

  constructor(private dependencies: SessionSseHubDependencies) {}

  get size() {
    return this.clients.size;
  }

  response(request: Request) {
    let activeController:
      | ReadableStreamDefaultController<Uint8Array>
      | undefined;
    const stream = new ReadableStream<Uint8Array>({
      start: async (controller) => {
        activeController = controller;
        this.clients.add(controller);
        void this.dependencies.touchClientActivity();
        request.signal.addEventListener(
          'abort',
          () => {
            this.removeClient(controller, {close: true});
          },
          {once: true}
        );
        const snapshot = await this.dependencies.loadSnapshot();
        controller.enqueue(this.encode('snapshot', snapshot));
        const exerciseSnapshot =
          await this.dependencies.loadExerciseSnapshot?.();
        if (exerciseSnapshot) {
          controller.enqueue(this.encode('exercise_state', exerciseSnapshot));
        }
        for (const event of await this.dependencies.loadReplayBuffer()) {
          controller.enqueue(this.encode('replay', event));
        }
      },
      cancel: () => {
        if (activeController) this.removeClient(activeController);
      },
    });
    return new Response(stream, {
      headers: {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      },
    });
  }

  broadcast(event: string, data: unknown) {
    const chunk = this.encode(event, data);
    for (const client of this.clients) {
      try {
        client.enqueue(chunk);
      } catch {
        this.removeClient(client);
      }
    }
  }

  private removeClient(
    controller: ReadableStreamDefaultController<Uint8Array>,
    options: {close?: boolean} = {}
  ) {
    const deleted = this.clients.delete(controller);
    if (deleted) void this.dependencies.onClientClose();
    if (options.close) {
      try {
        controller.close();
      } catch {
        /* ignore */
      }
    }
  }

  private encode(event: string, data: unknown) {
    return this.encoder.encode(
      `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
    );
  }
}
