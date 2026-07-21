import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AlertTitle, Box, Button, Collapse, Link } from '@mui/material';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import { useTranslation } from 'react-i18next';
import { ecfService } from '../../../services/api';

/** DGII OFV portal for contingency invoice reporting */
const DGII_OFV_URL = 'https://ofv.dgii.gov.do/';
const POLL_INTERVAL_MS = 60_000;

interface ContingencyBannerProps {
  /** Override to always show (useful for testing) */
  forceShow?: boolean;
}

const ContingencyBanner: React.FC<ContingencyBannerProps> = ({ forceShow }) => {
  const { t } = useTranslation();
  const [offline, setOffline] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const checkHealth = useCallback(async () => {
    try {
      const res = await ecfService.checkHealth();
      const isOnline = res.data?.data?.online ?? true;
      setOffline(!isOnline);
      if (isOnline) setDismissed(false); // re-show if connectivity restored
    } catch {
      setOffline(true);
    }
  }, []);

  useEffect(() => {
    checkHealth();
    intervalRef.current = setInterval(checkHealth, POLL_INTERVAL_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [checkHealth]);

  const show = forceShow || (offline && !dismissed);

  return (
    <Collapse in={show} unmountOnExit>
      <Box sx={{ mb: 2 }}>
        <Alert
          severity="warning"
          icon={<WarningAmberIcon />}
          onClose={() => setDismissed(true)}
          action={
            <Button
              color="inherit"
              size="small"
              component={Link}
              href={DGII_OFV_URL}
              target="_blank"
              rel="noopener noreferrer"
            >
              {t('admin.ecf.contingency.dgiiLink')}
            </Button>
          }
        >
          <AlertTitle>{t('admin.ecf.contingency.title')}</AlertTitle>
          {t('admin.ecf.contingency.message')}
        </Alert>
      </Box>
    </Collapse>
  );
};

export default ContingencyBanner;
