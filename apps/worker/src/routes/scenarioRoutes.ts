import {getScenario, listScenarios} from '@incident/scenarios';
import type {WorkerApp} from '../http/context.js';
import {err, ok} from '../http/response.js';

export function registerScenarioRoutes(app: WorkerApp) {
  app.get('/api/scenarios', (c) => c.json(ok(listScenarios())));

  app.get('/api/scenarios/:scenarioId', (c) => {
    const scenario = getScenario(c.req.param('scenarioId'));
    if (!scenario) return c.json(err('not_found', 'scenario not found'), 404);
    return c.json(ok(scenario));
  });
}
