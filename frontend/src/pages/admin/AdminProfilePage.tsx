import React from 'react';
import AdminLayout from '../../components/admin/AdminLayout';
import ProfileView from '../../components/shared/ProfileView';

const AdminProfilePage: React.FC = () => (
  <AdminLayout>
    <ProfileView />
  </AdminLayout>
);

export default AdminProfilePage;
