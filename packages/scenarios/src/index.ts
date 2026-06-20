import type { ScenarioDefinition } from "@incident/shared";
import { validateScenarioDefinition } from "@incident/shared";
import processStop from "../data/process-stop-001.json" with { type: "json" };
import diskFull from "../data/disk-full-001.json" with { type: "json" };
import unlangBatch from "../data/unlang-batch-001.json" with { type: "json" };

export const beginnerScenarios = [
  processStop,
  diskFull,
  unlangBatch
] as ScenarioDefinition[];

export function listScenarios() {
  return beginnerScenarios.map((scenario) => ({
    id: scenario.id,
    version: scenario.version,
    title: scenario.title,
    difficulty: scenario.difficulty,
    timeLimitMinutes: scenario.timeLimitMinutes
  }));
}

export function getScenario(id: string): ScenarioDefinition | undefined {
  return beginnerScenarios.find((scenario) => scenario.id === id);
}

export function validateAllScenarios(): string[] {
  return beginnerScenarios.flatMap((scenario) => {
    const result = validateScenarioDefinition(scenario);
    return result.ok ? [] : result.errors.map((error) => `${scenario.id}: ${error}`);
  });
}
