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
  lines.push('', plan.hasConflicts ? 'Result: review conflicts; no changes made.' : 'Result: ready; no changes made.');
  return `${lines.join('\n')}\n`;
}
