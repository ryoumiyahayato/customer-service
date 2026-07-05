import { normalizeDeploymentConfig, redactConfig, type DeploymentConfig } from './config.js';
import { plannedRemoteCommands, generateRedactedRemoteEnv } from './remoteCommands.js';
import { redactText } from './redact.js';
import { assertValidDeploymentConfig } from './validation.js';

export type DeploymentPlanStep = {
  id: string;
  title: string;
  detail: string;
};

export type DeploymentPlan = {
  ok: true;
  mode: 'mock' | 'real';
  dryRun: boolean;
  runMigrations: boolean;
  target: {
    appUrl: string;
    setupUrl: string;
    remoteLinuxDir: string;
  };
  config: ReturnType<typeof redactConfig>;
  steps: DeploymentPlanStep[];
  remoteCommands: string[];
  remoteEnvPreview: string;
};

export function generateDeploymentPlan(config: DeploymentConfig): DeploymentPlan {
  assertValidDeploymentConfig(config);
  const normalized = normalizeDeploymentConfig(config);
  const appUrl = `https://${config.appDomain}`;
  const setupUrl = `${appUrl}/setup`;
  const steps: DeploymentPlanStep[] = [
    { id: 'test-ssh', title: '测试 SSH 连接', detail: '验证远程 Linux 服务器 SSH 可用。' },
    { id: 'create-remote-dir', title: '创建远程目录', detail: `创建 ${normalized.remoteLinuxDir}。` },
    { id: 'upload-linux-deploy', title: '上传 Linux 部署文件', detail: '上传 deploy/linux 目录，排除 .env、logs、storage、backup、node_modules 和 .git。' },
    { id: 'env-reminder', title: '远程 .env 提醒', detail: '第一包不自动写真实 .env；请在服务器侧复制 .env.example 并填写 secret。' },
    { id: 'run-self-check', title: '执行 install.sh self-check', detail: '远程运行 ./install.sh --self-check。' },
    { id: 'run-install', title: '执行 install.sh', detail: normalized.dryRun ? '计划执行 ./install.sh --dry-run。' : normalized.runMigrations ? '计划执行 ./install.sh --migrate。' : '计划执行 ./install.sh。' },
    { id: 'show-urls', title: '输出访问地址', detail: `后台：${appUrl}；初始化：${setupUrl}` },
  ];

  return {
    ok: true,
    mode: normalized.mode,
    dryRun: normalized.dryRun,
    runMigrations: normalized.runMigrations,
    target: {
      appUrl,
      setupUrl,
      remoteLinuxDir: normalized.remoteLinuxDir,
    },
    config: redactConfig(normalized),
    steps: steps.map((step) => ({
      ...step,
      detail: redactText(step.detail, config),
    })),
    remoteCommands: plannedRemoteCommands(normalized).map((command) => redactText(command, config)),
    remoteEnvPreview: generateRedactedRemoteEnv(config),
  };
}
