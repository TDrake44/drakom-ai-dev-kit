import type { OperationAction, OperationPlan } from './operation-plan.js';

const labels: Record<OperationAction, string> = {
  mkdir: 'MKDIR',
  create: 'CREATE',
  update: 'UPDATE',
  delete: 'DELETE',
  merge: 'MERGE',
  preserve: 'PRESERVE',
  conflict: 'CONFLICT',
  warning: 'WARNING',
};

function renderResult(plan: OperationPlan): string {
  if (!plan.hasConflicts) return 'Result: ready.';
  if (plan.partialApply !== true) return 'Result: review conflicts; no changes made.';
  const count = plan.operations.filter(({ action }) => action === 'conflict').length;
  return `Result: ${count} ${count === 1 ? 'conflict' : 'conflicts'} to review; only the conflicting items are held back.`;
}

export function renderPlan(plan: OperationPlan): string {
  const lines = [
    `Drakom AI ${plan.command} plan`,
    `Target: ${plan.root}`,
    `Status: ${plan.targetStatus}`,
    '',
  ];
  if (plan.detectedContext !== undefined) {
    if (plan.detectedContext.length === 0) {
      lines.push('Detected context sources: none', '');
    } else {
      lines.push('Detected context sources:', ...plan.detectedContext.map((contextPath) => `  ${contextPath}`), '');
    }
  }
  for (const operation of plan.operations) {
    lines.push(`${labels[operation.action].padEnd(8)} ${operation.path} — ${operation.summary}`);
  }
  lines.push('', renderResult(plan));
  return `${lines.join('\n')}\n`;
}
