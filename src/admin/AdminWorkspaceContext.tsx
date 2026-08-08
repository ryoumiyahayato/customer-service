import { createContext, useContext } from 'react';
import type { AdminIdentity, ChatSession, OperatorSummary } from '../chatModel';

export type AdminCapabilities = {
  canCreateInvites: boolean;
  canUseStaffChat: boolean;
  canUploadImages: boolean;
};

export type AdminCoreView = 'sessions' | 'operators' | 'staffChat';
export type AdminMobileView = 'dir' | 'chat' | 'panel';

export type AdminWorkspaceValue = {
  admin: AdminIdentity;
  sessions: ChatSession[];
  currentSession: ChatSession | null;
  currentCustomerName: string;
  operators: OperatorSummary[];
  capabilities: AdminCapabilities;
  unreadCount: number;
  view: AdminCoreView;
  mobileView: AdminMobileView;
  isNarrow: boolean;
  openView: (view: AdminCoreView, mobileView?: AdminMobileView) => void;
  setMobileView: (view: AdminMobileView) => void;
  refreshSessions: () => Promise<void>;
  logout: () => Promise<void>;
  logoutLoading: boolean;
};

const AdminWorkspaceContext = createContext<AdminWorkspaceValue | null>(null);

export function AdminWorkspaceProvider({ value, children }: { value: AdminWorkspaceValue; children: React.ReactNode }) {
  return <AdminWorkspaceContext.Provider value={value}>{children}</AdminWorkspaceContext.Provider>;
}

export function useAdminWorkspace() {
  const value = useContext(AdminWorkspaceContext);
  if (!value) throw new Error('useAdminWorkspace must be used inside AdminWorkspaceProvider');
  return value;
}
