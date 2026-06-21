import type { ScenarioDefinition } from "./types.js";

/** Recovery can only be declared after every scenario trigger has fired. */
export function canDeclareRecovery(
  scenario: Pick<ScenarioDefinition, "triggers">,
  triggeredIds: readonly string[]
): boolean {
  if (scenario.triggers.length === 0) return true;
  return scenario.triggers.every((trigger) => triggeredIds.includes(trigger.id));
}
