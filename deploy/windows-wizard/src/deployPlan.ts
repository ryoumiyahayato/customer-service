import { redactConfig, type DeploymentConfig } from './config.js';
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
  target: {
    appUrl: string;
    setupUrl: string;
  };
  config: ReturnType<typeof redactConfig>;
  steps: DeploymentPlanStep[];
  remoteCommands: string[];
  remoteEnvPreview: string;
};

export function generateDeploymentPlan(config: DeploymentConfig): DeploymentPlan {
  assertValidDeploymentConfig(config);
  const appUrl = `https://${config.appDomain}`;
  const setupUrl = `${appUrl}/setup`;
  const steps: DeploymentPlanStep[] = [
    { id: 'test-ssh', title: '测试 SSH 连接', detail: '验证远程 Linux 服务器 SSH 可用。' },
    { id: 'create-remote-dir', title: '创建远程目录', detail: `创建 ${config.remoteDir}。` },
    { id: 'upload-linux-deploy', title: '上传 Linux 部署文件', detail: '上传 deploy/linux 目录和应用构建产物。' },
    { id: 'write-env', title: '写入远程 .env', detail: '生成并上传服务器端 .env，日志只展示脱敏版本。' },
    { id: 'run-install', title: '执行 install.sh', detail: '远程运行 Linux 安装脚本。' },
    { id: 'run-healthcheck', title: '执行 healthcheck.sh', detail: '远程运行健康检查脚本。' },
    { id: 'show-urls', title: '输出访问地址', detail: `后台：${appUrl}；初始化：${setupUrl}` },
  ];

  return {
    ok: true,
    target: {
      appUrl,
      setupUrl,
    },
    config: redactConfig(config),
    steps: steps.map((step) => ({
      ...step,
      detail: redactText(step.detail, config),
    })),
    remoteCommands: plannedRemoteCommands(config).map((command) => redactText(command, config)),
    remoteEnvPreview: generateRedactedRemoteEnv(config),
  };
}
