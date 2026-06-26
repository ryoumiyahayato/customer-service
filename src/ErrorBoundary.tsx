import { Component, ErrorInfo, ReactNode } from 'react';
import { copyText, getErrorMessage } from './compat';

type Props = { children: ReactNode };
type State = { error: string };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: '' };

  static getDerivedStateFromError(error: unknown) {
    return { error: getErrorMessage(error) };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('React render error', error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return <CrashScreen message={this.state.error} />;
  }
}

export function CrashScreen({ message }: { message: string }) {
  async function copy() {
    try {
      await copyText(message);
      alert('错误信息已复制');
    } catch (error) {
      alert(getErrorMessage(error));
    }
  }

  return <div className="page crash-page"><div className="crash-card"><h1>页面加载失败</h1><p>请刷新重试，或更换浏览器。</p><pre>错误信息：{message}</pre><button onClick={copy}>复制错误信息</button><button className="secondary" onClick={() => location.reload()}>刷新重试</button></div></div>;
}