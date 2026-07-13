import type {Difficulty, ScenarioDefinition} from '@incident/shared';
import {validateScenarioDefinition} from '@incident/shared';
import processStop from '../data/process-stop-001.json' with {type: 'json'};
import diskFull from '../data/disk-full-001.json' with {type: 'json'};
import hangBasics from '../data/hang-basics-001.json' with {type: 'json'};
import configRollback from '../data/config-rollback-001.json' with {type: 'json'};
import alertTriage from '../data/alert-triage-001.json' with {type: 'json'};
import kodamaBatch from '../data/kodama-batch-001.json' with {type: 'json'};
import dbPool from '../data/db-pool-001.json' with {type: 'json'};
import badDeploy from '../data/bad-deploy-001.json' with {type: 'json'};
import apiHang from '../data/api-hang-001.json' with {type: 'json'};
import portConflict from '../data/port-conflict-001.json' with {type: 'json'};
import logBloat from '../data/log-bloat-001.json' with {type: 'json'};
import diskRestartLoop from '../data/disk-restart-loop-001.json' with {type: 'json'};
import monitorBlind from '../data/monitor-blind-001.json' with {type: 'json'};
import kodamaMystery from '../data/kodama-mystery-001.json' with {type: 'json'};
import janitorPower from '../data/janitor-power-001.json' with {type: 'json'};
import cableJumprope from '../data/cable-jumprope-001.json' with {type: 'json'};
import keyboardSpill from '../data/keyboard-spill-001.json' with {type: 'json'};
import alertSpam from '../data/alert-spam-001.json' with {type: 'json'};
import runbookGaslight from '../data/runbook-gaslight-001.json' with {type: 'json'};
import chaoticNight from '../data/chaotic-night-001.json' with {type: 'json'};

const difficultyOrder: Record<Difficulty, number> = {
  beginner: 0,
  intermediate: 1,
  advanced: 2,
};

export const scenarios = (
  [
    processStop,
    diskFull,
    hangBasics,
    configRollback,
    alertTriage,
    kodamaBatch,
    dbPool,
    badDeploy,
    apiHang,
    portConflict,
    logBloat,
    diskRestartLoop,
    monitorBlind,
    kodamaMystery,
    janitorPower,
    cableJumprope,
    keyboardSpill,
    alertSpam,
    runbookGaslight,
    chaoticNight,
  ] as ScenarioDefinition[]
).sort((a, b) => {
  const difficultyDiff =
    difficultyOrder[a.difficulty] - difficultyOrder[b.difficulty];
  if (difficultyDiff !== 0) return difficultyDiff;
  const scoreDiff = a.difficultyScore - b.difficultyScore;
  if (scoreDiff !== 0) return scoreDiff;
  return a.id.localeCompare(b.id);
});

export function listScenarios() {
  return scenarios.map((scenario) => ({
    id: scenario.id,
    version: scenario.version,
    title: scenario.title,
    difficulty: scenario.difficulty,
    timeLimitMinutes: scenario.timeLimitMinutes,
  }));
}

export function getScenario(id: string): ScenarioDefinition | undefined {
  return scenarios.find((scenario) => scenario.id === id);
}

export function getRandomScenarioByDifficulty(
  difficulty: Difficulty,
  random: () => number = Math.random
): ScenarioDefinition | undefined {
  const matching = scenarios.filter(
    (scenario) => scenario.difficulty === difficulty
  );
  if (matching.length === 0) return undefined;
  return matching[Math.floor(random() * matching.length) % matching.length];
}

export function validateAllScenarios(): string[] {
  return scenarios.flatMap((scenario) => {
    const result = validateScenarioDefinition(scenario);
    return result.ok
      ? []
      : result.errors.map((error) => `${scenario.id}: ${error}`);
  });
}
