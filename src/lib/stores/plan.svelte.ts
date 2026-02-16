import { browser } from '$app/environment';

export type PlanType = 'api' | 'pro' | 'max' | 'enterprise';

export const PLAN_LABELS: Record<PlanType, string> = {
	api: 'API',
	pro: 'Pro',
	max: 'Max',
	enterprise: 'Enterprise'
};

const STORAGE_KEY = 'agent-replay-plan';

function loadPlan(): PlanType {
	if (!browser) return 'api';
	return (localStorage.getItem(STORAGE_KEY) as PlanType) || 'api';
}

let plan = $state<PlanType>(loadPlan());

export function getPlan(): PlanType {
	return plan;
}

export function setPlan(p: PlanType) {
	plan = p;
	if (browser) localStorage.setItem(STORAGE_KEY, p);
}

export function isIncludedPlan(): boolean {
	return plan !== 'api';
}
