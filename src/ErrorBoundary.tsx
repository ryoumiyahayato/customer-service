import { Component, ErrorInfo, ReactNode } from 'react';
import { copyText, getErrorMessage, isExpectedError } from './compat';

type Props = { children: ReactNode; isAdmin?: boolean };
type State = { error: string; isExpected: boolean };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: '', isExpected: false };

  static getDerivedStateFromError(error: unknown) {
    if (isExpectedError(error)) {
      return { error: '', isExpected: true };
    }
    return { error: getErrorMessage(error), isExpected: false };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    if (!isExpectedError(error)) {
      console.error('React render error', error, info);
    }
  }

  render() {
    if (!this.state.error) return this.props.children;
    return <CrashScreen message={this.state.error} isExpected={this.state.isExpected} isAdmin={this.props.isAdmin} />;
  }
}

export function CrashScreen({ message, isExpected, isAdmin }: { message: string; isExpected?: boolean; isAdmin?: boolean }) {
  const displayMessage = isExpected ? '网络不稳定，请重试' : message;

  async function copy() {
    try {
      await copyText(message);
      alert('错误信息已复制');
    } catch (error) {
      alert(getErrorMessage(error));
    }
  }

  if (isExpected || !isAdmin) {
    return <div className="page crash-page"><div className="crash-card"><h1>网络不稳定</h1><p>请求超时，请检查网络后重试</p><pre>错误信息：网络不稳定，请重试</pre><button className="secondary" onClick={() => location.reload()}>刷新重试</button></div></div>;
  }

  return <div className="page crash-page"><div className="crash-card"><h1>页面加载失败</h1><p>请刷新重试，或更换浏览器。</p><pre>错误信息：{displayMessage}</pre><button onClick={copy}>复制错误信息</button><button className="secondary" onClick={() => location.reload()}>刷新重试</button></div></div>;
}
