import AdminDashboard from '../admin/AdminDashboard';
import DesktopAdminPolish from '../admin/DesktopAdminPolish';
import SuperAdminStaffClearControl from '../admin/SuperAdminStaffClearControl';
import AdminMobileShell from '../admin/AdminMobileShell';
import SessionClientInfo from '../admin/SessionClientInfo';
import '../admin/mobileAdminPolish.css';
import '../admin/adminShellFinal.css';
import '../admin/adminRegressionFixes.css';

export default function AdminApp() {
  return (
    <>
      <AdminDashboard />
      <DesktopAdminPolish />
      <SessionClientInfo />
      <AdminMobileShell />
      <SuperAdminStaffClearControl />
    </>
  );
}
