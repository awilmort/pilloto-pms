/** Readiness checks with a plain-language message and a link to the screen that fixes each. */
import React from 'react';
import { Alert, Box, Button, Typography } from '@mui/material';
import { CheckCircle } from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { ReadinessCheck, ReadinessId } from '../../../services/api';

interface Props {
  checks: ReadinessCheck[];
  /** Only these checks (default: all) */
  only?: ReadinessId[];
  /** Show passing checks too */
  showOk?: boolean;
}

const ReadinessList: React.FC<Props> = ({ checks, only, showOk }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const shown = checks.filter((c) => (!only || only.includes(c.id)) && (showOk || c.status !== 'ok'));
  if (!shown.length) return null;
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      {shown.map((c) => c.status === 'ok' ? (
        <Box key={c.id} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <CheckCircle fontSize="small" color="success" />
          <Typography variant="body2">{t(`admin.channelManager.checks.${c.id}.ok`)}</Typography>
        </Box>
      ) : (
        <Alert key={c.id} severity={c.status === 'error' ? 'error' : 'warning'}
          action={<Button color="inherit" size="small" onClick={() => navigate(c.fixRoute)}>{t('admin.channelManager.checks.fix')}</Button>}>
          {t(`admin.channelManager.checks.${c.id}.problem`, { count: c.count ?? 0, defaultValue: c.message })}
        </Alert>
      ))}
    </Box>
  );
};

export default ReadinessList;
