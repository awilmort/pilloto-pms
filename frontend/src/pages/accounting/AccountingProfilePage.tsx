import React from 'react';
import { useTranslation } from 'react-i18next';
import AccountingLayout from '../../components/accounting/AccountingLayout';
import ProfileView from '../../components/shared/ProfileView';

const AccountingProfilePage: React.FC = () => {
  const { t } = useTranslation();
  return (
    <AccountingLayout title={t('pages.profile.title', 'Profile')}>
      <ProfileView />
    </AccountingLayout>
  );
};

export default AccountingProfilePage;
