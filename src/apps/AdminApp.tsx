import AdminDashboard from '../admin/AdminDashboard';
import DesktopAdminPolish from '../admin/DesktopAdminPolish';
import SuperAdminStaffClearControl from '../admin/SuperAdminStaffClearControl';
import '../admin/mobileAdminPolish.css';

export default function AdminApp() {
  return (
    <>
      <AdminDashboard />
      <DesktopAdminPolish />
      <SuperAdminStaffClearControl />
    </>
  );
}
