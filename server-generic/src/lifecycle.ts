export type LifecycleSchedulerPlan = {
  mode: 'cron' | 'systemd-timer' | 'app-scheduler';
  notes: string[];
};

export function describeLifecycleMigration(): LifecycleSchedulerPlan {
  return {
    mode: 'cron',
    notes: [
      'Cloudflare Scheduled Trigger will be mapped to cron, systemd timer, or app scheduler.',
      'The generic server package must reuse the existing lifecycle safety rules before enabling writes.',
      'Dry-run and write execution must stay separated.',
    ],
  };
}
