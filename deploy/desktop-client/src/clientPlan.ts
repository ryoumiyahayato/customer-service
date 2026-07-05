import type { DesktopClientConfig } from './config.js';
import { redactObject, redactUrl } from './redact.js';
import { assertValidDesktopClientConfig } from './validation.js';

export type ClientPlanStep = {
  id: string;
  title: string;
  detail: string;
};

export type ClientPlan = {
  ok: true;
  appName: string;
  mode: DesktopClientConfig['mode'];
  targetUrl: string;
  steps: ClientPlanStep[];
  todos: string[];
};

export function generateClientPlan(config: DesktopClientConfig): ClientPlan {
  assertValidDesktopClientConfig(config);
  const targetUrl = config.mode === 'visitor' && config.visitorRootUrl ? config.visitorRootUrl : config.adminUrl;
  const plan: ClientPlan = {
    ok: true,
    appName: config.appName,
    mode: config.mode,
    targetUrl: redactUrl(targetUrl),
    steps: [
      { id: 'validate-config', title: '校验配置', detail: '确认后台地址和客户端模式有效。' },
      { id: 'open-target', title: '打开目标系统', detail: `打开 ${redactUrl(targetUrl)}` },
      { id: 'window-title', title: '窗口标题', detail: config.windowTitle || config.appName },
      { id: 'window-state', title: '窗口状态', detail: config.rememberWindowState ? '后续保留窗口状态。' : '不保存窗口状态。' },
    ],
    todos: ['Tauri/Electron GUI TODO', '系统托盘 TODO', '原生通知 TODO', '自动更新 TODO'],
  };
  return redactObject(plan);
}
