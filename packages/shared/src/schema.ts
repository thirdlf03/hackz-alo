import type {ScenarioDefinition} from './types.js';

export type ValidationResult<T> =
  | {ok: true; value: T}
  | {ok: false; errors: string[]};

const difficulties = new Set(['beginner', 'intermediate', 'advanced']);
const triggerTypes = new Set([
  'process_stop',
  'disk_full',
  'unlang_batch_failure',
  'queue_backlog',
  'bad_deploy',
  'db_pool_exhaust',
  'memory_leak',
  'dns_misconfig',
  'monitor_blind',
  'composite_restart_loop',
  'janitor_power_pull',
  'cable_jumprope',
  'keyboard_spill',
  'alert_spam',
  'runbook_gaslight',
]);
const navigationPanels = new Set([
  'metrics',
  'terminal',
  'editor',
  'runbook',
  'slack',
]);
const alertSeverities = new Set(['info', 'warning', 'critical']);
const alertSources = new Set(['scenario', 'monitor']);
const participantRoles = new Set([
  'incident_commander',
  'ops',
  'scribe',
  'comms',
  'facilitator',
  'observer',
]);
const successTypes = new Set([
  'http_status',
  'disk_usage_below',
  'process_running',
  'marker_absent',
  'log_absent',
  'unlang_batch_ok',
]);
const idPattern = /^[a-zA-Z0-9._-]+$/;

export function validateScenarioDefinition(
  input: unknown
): ValidationResult<ScenarioDefinition> {
  const errors: string[] = [];
  const value = input as Record<string, unknown>;

  if (!isObject(value)) {
    return {ok: false, errors: ['scenario must be an object']};
  }

  requireId(value, 'id', errors);
  requirePositiveInteger(value, 'version', errors);
  requireString(value, 'title', errors);
  requirePositiveNumber(value, 'timeLimitMinutes', errors);

  if (
    typeof value.difficulty !== 'string' ||
    !difficulties.has(value.difficulty)
  ) {
    errors.push('difficulty must be beginner, intermediate, or advanced');
  }

  if (!isObject(value.service)) {
    errors.push('service must be an object');
  } else {
    requireString(value.service, 'name', errors, 'service');
    requireHttpUrl(value.service, 'healthUrl', errors, 'service');
  }

  validateArray(value, 'briefing', errors, (item, path) => {
    if (typeof item !== 'string') errors.push(`${path} must be a string`);
  });
  requireNonEmptyArray(value, 'briefing', errors);

  const startupIds = new Set<string>();
  validateArray(value, 'startup', errors, (item, path) => {
    if (!isObject(item)) {
      errors.push(`${path} must be an object`);
      return;
    }
    requireId(item, 'id', errors, path);
    rememberUnique(startupIds, item.id, `${path}.id`, errors);
    requireString(item, 'command', errors, path);
    if (item.waitForPort !== undefined) {
      requirePort(item, 'waitForPort', errors, path);
    }
  });
  requireNonEmptyArray(value, 'startup', errors);

  const triggerIds = new Set<string>();
  validateArray(value, 'triggers', errors, (item, path) => {
    if (!isObject(item)) {
      errors.push(`${path} must be an object`);
      return;
    }
    requireId(item, 'id', errors, path);
    rememberUnique(triggerIds, item.id, `${path}.id`, errors);
    requireNonNegativeInteger(item, 'atMs', errors, path);
    if (typeof item.type !== 'string' || !triggerTypes.has(item.type)) {
      errors.push(`${path}.type must be a supported trigger type`);
    }
    validateTriggerParams(item, path, errors);
  });

  const alertIds = new Set<string>();
  validateArray(value, 'alerts', errors, (item, path) => {
    if (!isObject(item)) {
      errors.push(`${path} must be an object`);
      return;
    }
    requireId(item, 'id', errors, path);
    rememberUnique(alertIds, item.id, `${path}.id`, errors);
    requireNonNegativeInteger(item, 'atMs', errors, path);
    if (
      typeof item.severity !== 'string' ||
      !alertSeverities.has(item.severity)
    ) {
      errors.push(`${path}.severity must be info, warning, or critical`);
    }
    requireString(item, 'message', errors, path);
    if (typeof item.source !== 'string' || !alertSources.has(item.source)) {
      errors.push(`${path}.source must be scenario or monitor`);
    }
  });

  validateArray(value, 'successConditions', errors, (item, path) => {
    if (!isObject(item)) {
      errors.push(`${path} must be an object`);
      return;
    }
    if (typeof item.type !== 'string' || !successTypes.has(item.type)) {
      errors.push(`${path}.type must be a supported success condition type`);
    }
    validateSuccessCondition(item, path, errors);
  });
  requireNonEmptyArray(value, 'successConditions', errors);

  const runbookIds = new Set<string>();
  validateArray(value, 'runbooks', errors, (item, path) => {
    if (!isObject(item)) {
      errors.push(`${path} must be an object`);
      return;
    }
    requireId(item, 'id', errors, path);
    rememberUnique(runbookIds, item.id, `${path}.id`, errors);
    requireString(item, 'title', errors, path);
    requireString(item, 'body', errors, path);
    if (item.availableAtMs !== undefined) {
      requireNonNegativeInteger(item, 'availableAtMs', errors, path);
    }
  });
  requireNonEmptyArray(value, 'runbooks', errors);

  const slackMessageIds = new Set<string>();
  validateArray(value, 'slackMessages', errors, (item, path) => {
    if (!isObject(item)) {
      errors.push(`${path} must be an object`);
      return;
    }
    requireId(item, 'id', errors, path);
    rememberUnique(slackMessageIds, item.id, `${path}.id`, errors);
    requireNonNegativeInteger(item, 'atMs', errors, path);
    requireString(item, 'from', errors, path);
    requireString(item, 'body', errors, path);
  });

  const navigationStepIds = new Set<string>();
  if (value.navigationSteps !== undefined) {
    validateArray(value, 'navigationSteps', errors, (item, path) => {
      if (!isObject(item)) {
        errors.push(`${path} must be an object`);
        return;
      }
      requireId(item, 'id', errors, path);
      rememberUnique(navigationStepIds, item.id, `${path}.id`, errors);
      requireNonNegativeInteger(item, 'atMs', errors, path);
      requireString(item, 'hint', errors, path);
      if (
        item.panel !== undefined &&
        (typeof item.panel !== 'string' || !navigationPanels.has(item.panel))
      ) {
        errors.push(
          `${path}.panel must be metrics, terminal, editor, runbook, or slack`
        );
      }
      if (
        item.suggestedCommand !== undefined &&
        typeof item.suggestedCommand !== 'string'
      ) {
        errors.push(`${path}.suggestedCommand must be a string`);
      }
    });
  }

  if (value.exercise !== undefined) {
    if (!isObject(value.exercise)) {
      errors.push('exercise must be an object');
    } else {
      validateExercise(value.exercise, errors);
    }
  }

  validateTimelineBounds(value, errors);

  if (errors.length > 0) return {ok: false, errors};
  return {ok: true, value: input as ScenarioDefinition};
}

function validateExercise(exercise: Record<string, unknown>, errors: string[]) {
  if (exercise.injects === undefined) return;
  const injectIds = new Set<string>();
  validateArray(exercise, 'injects', errors, (item, path) => {
    if (!isObject(item)) {
      errors.push(`${path} must be an object`);
      return;
    }
    requireId(item, 'id', errors, path);
    rememberUnique(injectIds, item.id, `${path}.id`, errors);
    if (item.atMs !== undefined) {
      requireNonNegativeInteger(item, 'atMs', errors, path);
    }
    requireString(item, 'title', errors, path);
    requireString(item, 'body', errors, path);
    if (
      item.roleHint !== undefined &&
      (typeof item.roleHint !== 'string' ||
        !participantRoles.has(item.roleHint))
    ) {
      errors.push(`${path}.roleHint must be a supported participant role`);
    }
  });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(
  target: Record<string, unknown>,
  key: string,
  errors: string[],
  prefix?: string
) {
  if (typeof target[key] !== 'string' || target[key] === '') {
    errors.push(
      `${prefix ? `${prefix}.` : ''}${key} must be a non-empty string`
    );
  }
}

function requireFiniteNumber(
  target: Record<string, unknown>,
  key: string,
  errors: string[],
  prefix?: string
): boolean {
  if (typeof target[key] !== 'number' || !Number.isFinite(target[key])) {
    errors.push(`${prefix ? `${prefix}.` : ''}${key} must be a finite number`);
    return false;
  }
  return true;
}

function requirePositiveNumber(
  target: Record<string, unknown>,
  key: string,
  errors: string[],
  prefix?: string
) {
  if (
    requireFiniteNumber(target, key, errors, prefix) &&
    (target[key] as number) <= 0
  ) {
    errors.push(`${prefix ? `${prefix}.` : ''}${key} must be greater than 0`);
  }
}

function requirePositiveInteger(
  target: Record<string, unknown>,
  key: string,
  errors: string[],
  prefix?: string
) {
  if (
    requireFiniteNumber(target, key, errors, prefix) &&
    (!Number.isInteger(target[key]) || (target[key] as number) <= 0)
  ) {
    errors.push(
      `${prefix ? `${prefix}.` : ''}${key} must be a positive integer`
    );
  }
}

function requireNonNegativeInteger(
  target: Record<string, unknown>,
  key: string,
  errors: string[],
  prefix?: string
) {
  if (
    requireFiniteNumber(target, key, errors, prefix) &&
    (!Number.isInteger(target[key]) || (target[key] as number) < 0)
  ) {
    errors.push(
      `${prefix ? `${prefix}.` : ''}${key} must be a non-negative integer`
    );
  }
}

function requirePercent(
  target: Record<string, unknown>,
  key: string,
  errors: string[],
  prefix?: string
) {
  if (
    requireFiniteNumber(target, key, errors, prefix) &&
    ((target[key] as number) < 0 || (target[key] as number) > 100)
  ) {
    errors.push(
      `${prefix ? `${prefix}.` : ''}${key} must be between 0 and 100`
    );
  }
}

function requireHttpStatus(
  target: Record<string, unknown>,
  key: string,
  errors: string[],
  prefix?: string
) {
  if (
    requireFiniteNumber(target, key, errors, prefix) &&
    (!Number.isInteger(target[key]) ||
      (target[key] as number) < 100 ||
      (target[key] as number) > 599)
  ) {
    errors.push(
      `${prefix ? `${prefix}.` : ''}${key} must be an HTTP status code`
    );
  }
}

function requirePort(
  target: Record<string, unknown>,
  key: string,
  errors: string[],
  prefix?: string
) {
  if (
    requireFiniteNumber(target, key, errors, prefix) &&
    (!Number.isInteger(target[key]) ||
      (target[key] as number) < 1 ||
      (target[key] as number) > 65535)
  ) {
    errors.push(`${prefix ? `${prefix}.` : ''}${key} must be a TCP port`);
  }
}

function requireId(
  target: Record<string, unknown>,
  key: string,
  errors: string[],
  prefix?: string
) {
  const path = `${prefix ? `${prefix}.` : ''}${key}`;
  if (typeof target[key] !== 'string' || target[key] === '') {
    errors.push(`${path} must be a non-empty string`);
    return;
  }
  if (!idPattern.test(target[key])) {
    errors.push(
      `${path} must contain only letters, numbers, dot, underscore, or hyphen`
    );
  }
}

function requireHttpUrl(
  target: Record<string, unknown>,
  key: string,
  errors: string[],
  prefix?: string
) {
  requireString(target, key, errors, prefix);
  if (typeof target[key] !== 'string' || target[key] === '') return;
  try {
    const url = new URL(target[key]);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      errors.push(`${prefix ? `${prefix}.` : ''}${key} must be an HTTP(S) URL`);
    }
  } catch {
    errors.push(`${prefix ? `${prefix}.` : ''}${key} must be a valid URL`);
  }
}

function validateArray(
  target: Record<string, unknown>,
  key: string,
  errors: string[],
  validateItem: (item: unknown, path: string) => void
) {
  const value = target[key];
  if (!Array.isArray(value)) {
    errors.push(`${key} must be an array`);
    return;
  }
  value.forEach((item, index) => {
    validateItem(item, `${key}[${String(index)}]`);
  });
}

function requireNonEmptyArray(
  target: Record<string, unknown>,
  key: string,
  errors: string[]
) {
  if (Array.isArray(target[key]) && target[key].length === 0) {
    errors.push(`${key} must contain at least one item`);
  }
}

function rememberUnique(
  seen: Set<string>,
  value: unknown,
  path: string,
  errors: string[]
) {
  if (typeof value !== 'string' || value === '') return;
  if (seen.has(value)) {
    errors.push(`${path} must be unique`);
    return;
  }
  seen.add(value);
}

function validateTriggerParams(
  trigger: Record<string, unknown>,
  path: string,
  errors: string[]
) {
  if (!isObject(trigger.params)) {
    errors.push(`${path}.params must be an object`);
    return;
  }

  if (trigger.type === 'process_stop') {
    requireString(trigger.params, 'processId', errors, `${path}.params`);
  } else if (trigger.type === 'disk_full') {
    requireAbsolutePath(trigger.params, 'path', errors, `${path}.params`);
    requirePositiveInteger(trigger.params, 'bytes', errors, `${path}.params`);
  } else if (trigger.type === 'unlang_batch_failure') {
    requireString(trigger.params, 'jobId', errors, `${path}.params`);
    requireAbsolutePath(trigger.params, 'path', errors, `${path}.params`);
    if (
      trigger.params.specInComments !== undefined &&
      typeof trigger.params.specInComments !== 'boolean'
    ) {
      errors.push(`${path}.params.specInComments must be a boolean`);
    }
  } else if (trigger.type === 'queue_backlog') {
    requirePositiveInteger(trigger.params, 'count', errors, `${path}.params`);
  } else if (trigger.type === 'bad_deploy') {
    requireAbsolutePath(trigger.params, 'configPath', errors, `${path}.params`);
  } else if (trigger.type === 'db_pool_exhaust') {
    requirePositiveInteger(
      trigger.params,
      'maxConnections',
      errors,
      `${path}.params`
    );
  } else if (trigger.type === 'memory_leak') {
    requirePercent(trigger.params, 'targetPercent', errors, `${path}.params`);
  } else if (trigger.type === 'dns_misconfig') {
    requireAbsolutePath(trigger.params, 'hostsPath', errors, `${path}.params`);
  } else if (trigger.type === 'monitor_blind') {
    if (
      !Array.isArray(trigger.params.blindMetrics) ||
      trigger.params.blindMetrics.length === 0
    ) {
      errors.push(`${path}.params.blindMetrics must be a non-empty array`);
    }
  } else if (trigger.type === 'composite_restart_loop') {
    requireAbsolutePath(trigger.params, 'diskPath', errors, `${path}.params`);
    requirePositiveInteger(trigger.params, 'bytes', errors, `${path}.params`);
    requireString(trigger.params, 'processId', errors, `${path}.params`);
  } else if (trigger.type === 'janitor_power_pull') {
    if (trigger.params.processId !== undefined) {
      requireString(trigger.params, 'processId', errors, `${path}.params`);
    }
  } else if (trigger.type === 'cable_jumprope') {
    if (trigger.params.hostsPath !== undefined) {
      requireAbsolutePath(
        trigger.params,
        'hostsPath',
        errors,
        `${path}.params`
      );
    }
  } else if (trigger.type === 'keyboard_spill') {
    if (trigger.params.noise !== undefined) {
      requireString(trigger.params, 'noise', errors, `${path}.params`);
    }
  } else if (trigger.type === 'alert_spam') {
    if (trigger.params.count !== undefined) {
      requirePositiveInteger(trigger.params, 'count', errors, `${path}.params`);
    }
  } else if (trigger.type === 'runbook_gaslight') {
    if (trigger.params.replacement !== undefined) {
      requireString(trigger.params, 'replacement', errors, `${path}.params`);
    }
  }
}

function validateSuccessCondition(
  condition: Record<string, unknown>,
  path: string,
  errors: string[]
) {
  if (condition.type === 'http_status') {
    requireHttpUrl(condition, 'url', errors, path);
    requireHttpStatus(condition, 'status', errors, path);
  } else if (condition.type === 'disk_usage_below') {
    requireAbsolutePath(condition, 'path', errors, path);
    requirePercent(condition, 'valuePercent', errors, path);
  } else if (condition.type === 'process_running') {
    requireString(condition, 'processId', errors, path);
  } else if (condition.type === 'marker_absent') {
    requireAbsolutePath(condition, 'path', errors, path);
  } else if (condition.type === 'log_absent') {
    requireAbsolutePath(condition, 'path', errors, path);
    requireString(condition, 'pattern', errors, path);
  } else if (condition.type === 'unlang_batch_ok') {
    requireString(condition, 'jobId', errors, path);
  }
}

function requireAbsolutePath(
  target: Record<string, unknown>,
  key: string,
  errors: string[],
  prefix?: string
) {
  requireString(target, key, errors, prefix);
  if (
    typeof target[key] === 'string' &&
    target[key] !== '' &&
    !target[key].startsWith('/')
  ) {
    errors.push(`${prefix ? `${prefix}.` : ''}${key} must be an absolute path`);
  }
}

function validateTimelineBounds(
  value: Record<string, unknown>,
  errors: string[]
) {
  if (
    typeof value.timeLimitMinutes !== 'number' ||
    !Number.isFinite(value.timeLimitMinutes)
  ) {
    return;
  }
  const limitMs = value.timeLimitMinutes * 60 * 1000;

  for (const [key, label] of [
    ['triggers', 'triggers'],
    ['alerts', 'alerts'],
    ['slackMessages', 'slackMessages'],
    ['navigationSteps', 'navigationSteps'],
  ] as const) {
    const items = value[key];
    if (!Array.isArray(items)) continue;
    items.forEach((item, index) => {
      if (
        !isObject(item) ||
        typeof item.atMs !== 'number' ||
        !Number.isFinite(item.atMs)
      ) {
        return;
      }
      if (item.atMs > limitMs) {
        errors.push(
          `${label}[${String(index)}].atMs must be within timeLimitMinutes`
        );
      }
    });
  }
}
