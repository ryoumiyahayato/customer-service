import type { ChatSession } from '../chatModel';
import './sessionClientInfo.css';

export default function SessionClientInfo({ session }: { session: ChatSession | null }) {
  if (!session) return null;
  return (
    <details className="session-client-info">
      <summary>客户信息</summary>
      <dl>
        <div><dt>设备环境</dt><dd>{session.deviceLabel || '未知'}</dd></div>
        <div><dt>大致位置</dt><dd>{session.approximateLocation || '未知'}</dd></div>
        {session.ipAddress ? <div><dt>网络 IP</dt><dd>{session.ipAddress}</dd></div> : null}
      </dl>
      <small>
        {session.ipAddress
          ? '设备信息仅来自请求头中能够明确识别的字段；位置仅采用 Cloudflare 返回的粗粒度网络位置；IP 仅向超级管理员返回。'
          : '设备信息仅显示请求头中能够明确识别的字段，不猜测未知设备或应用版本；位置仅采用 Cloudflare 返回的粗粒度网络位置。'}
      </small>
    </details>
  );
}
