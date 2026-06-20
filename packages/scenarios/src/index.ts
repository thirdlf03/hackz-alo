import type { Difficulty, ScenarioDefinition } from "@incident/shared";
import { validateScenarioDefinition } from "@incident/shared";
import processStop from "../data/process-stop-001.json" with { type: "json" };
import diskFull from "../data/disk-full-001.json" with { type: "json" };
import unlangBatch from "../data/unlang-batch-001.json" with { type: "json" };
import dbPool from "../data/db-pool-001.json" with { type: "json" };
import badDeploy from "../data/bad-deploy-001.json" with { type: "json" };
import logBloat from "../data/log-bloat-001.json" with { type: "json" };
import diskRestartLoop from "../data/disk-restart-loop-001.json" with { type: "json" };
import monitorBlind from "../data/monitor-blind-001.json" with { type: "json" };
import unlangMystery from "../data/unlang-mystery-001.json" with { type: "json" };

export const scenarios = [
  processStop,
  diskFull,
  unlangBatch,
  dbPool,
  badDeploy,
  logBloat,
  diskRestartLoop,
  monitorBlind,
  unlangMystery
] as ScenarioDefinition[];

export function listScenarios() {
  return scenarios.map((scenario) => ({
    id: scenario.id,
    version: scenario.version,
    title: scenario.title,
    difficulty: scenario.difficulty,
    timeLimitMinutes: scenario.timeLimitMinutes
  }));
}

export function getScenario(id: string): ScenarioDefinition | undefined {
  return scenarios.find((scenario) => scenario.id === id);
}

export function getRandomScenarioByDifficulty(
  difficulty: Difficulty,
  random: () => number = Math.random
): ScenarioDefinition | undefined {
  const matching = scenarios.filter((scenario) => scenario.difficulty === difficulty);
  if (matching.length === 0) return undefined;
  return matching[Math.floor(random() * matching.length) % matching.length];
}

export function validateAllScenarios(): string[] {
  return scenarios.flatMap((scenario) => {
    const result = validateScenarioDefinition(scenario);
    return result.ok ? [] : result.errors.map((error) => `${scenario.id}: ${error}`);
  });
}
