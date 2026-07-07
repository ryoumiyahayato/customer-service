import { Component, ErrorInfo, ReactNode } from 'react';
import { isExpectedError } from './compat';

type Props = { children: ReactNode; isAdmin?: boolean };
type State = { error: boolean; isExpected: boolean };

const SUPPORT_ERROR_MESSAGE = '页面加载失败，请刷新重试，或更换浏览器。';
const NETWORK_ERROR_MESSAGE = '网络不稳定，请检查网络后重试。';

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: false, isExpected: false };

  static getDerivedStateFromError(error: unknown) {
    return { error: true, isExpected: isExpectedError(error) };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    if (import.meta.env.DEV && !isExpectedError(error)) {
      console.error('React render error', error, info);
    }
  }

  render() {
    if (!this.state.error) return this.props.children;
    return <CrashScreen isExpected={this.state.isExpected} isAdmin={this.props.isAdmin} />;
  }
}

export function CrashScreen({ isExpected, isAdmin }: { isExpected?: boolean; isAdmin?: boolean }) {
  const title = isExpected ? '网络不稳定' : '页面加载失败';
  const message = isExpected ? NETWORK_ERROR_MESSAGE : SUPPORT_ERROR_MESSAGE;

  return (
    <div className="page crash-page">
      <div className="crash-card">
        <h1>{title}</h1>
        <p>{message}</p>
        <pre>错误信息：{isExpected || !isAdmin ? '网络不稳定，请重试' : '页面加载失败'}</pre>
        <button className="secondary" onClick={() => location.reload()}>刷新重试</button>
      </div>
    </div>
  );
}
