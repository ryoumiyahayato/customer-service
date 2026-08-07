import AdminDashboard from '../admin/AdminDashboard';
import SuperAdminStaffClearControl from '../admin/SuperAdminStaffClearControl';
import '../admin/mobileAdminPolish.css';

export default function AdminApp() {
  return (
    <>
      <AdminDashboard />
      <SuperAdminStaffClearControl />
    </>
  );
}
