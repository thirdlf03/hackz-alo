import type {ScenarioDefinition} from '@incident/shared';
import type {HttpClient} from './httpClient.js';

export class ScenarioApi {
  constructor(private http: HttpClient) {}

  listScenarios() {
    return this.http.get<
      Array<
        Pick<
          ScenarioDefinition,
          'id' | 'title' | 'difficulty' | 'timeLimitMinutes'
        >
      >
    >('/api/scenarios');
  }

  getScenario(id: string) {
    return this.http.get<ScenarioDefinition>(
      `/api/scenarios/${encodeURIComponent(id)}`
    );
  }
}
