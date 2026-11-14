import React from 'react';
import { useTranslation } from 'react-i18next';
import { usePageTitle } from '../../components/shared/PageTitle';
import ProfileView from '../../components/shared/ProfileView';

const AccountingProfilePage: React.FC = () => {
  const { t } = useTranslation();
  usePageTitle(t('pages.profile.title', 'Profile'));
  return (
    <ProfileView />
  );
};

export default AccountingProfilePage;
