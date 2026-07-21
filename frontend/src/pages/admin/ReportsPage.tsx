import React from 'react';
import {
  Box,
  Button,
  Card,
  CardActions,
  CardContent,
  Chip,
  Grid,
  Stack,
  Typography,
} from '@mui/material';
import AssessmentIcon from '@mui/icons-material/Assessment';
import BarChartIcon from '@mui/icons-material/BarChart';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import VpnKeyIcon from '@mui/icons-material/VpnKey';
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty';
import NightsStayIcon from '@mui/icons-material/NightsStay';
import FlightLandIcon from '@mui/icons-material/FlightLand';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import AdminLayout from '../../components/admin/AdminLayout';
import MonthlyTaxReport from '../../components/admin/ecf/reports/MonthlyTaxReport';
import SequenceManagement from '../../components/admin/ecf/reports/SequenceManagement';
import PendingInvoiceQueue from '../../components/admin/ecf/reports/PendingInvoiceQueue';
import OccupancyReport from '../../components/admin/reports/OccupancyReport';
import NightAuditReport from '../../components/admin/reports/NightAuditReport';
import ArrivalsDeparturesReport from '../../components/admin/reports/ArrivalsDeparturesReport';

type ReportId = 'monthly-tax' | 'sequences' | 'pending-invoices' | 'occupancy' | 'night-audit' | 'arrivals-departures';

interface ReportCard {
  id: ReportId;
  titleKey: string;
  descriptionKey: string;
  icon: React.ReactNode;
  color: 'primary' | 'warning' | 'info' | 'success' | 'secondary';
  badgeKey?: string;
}

const REPORT_CARDS: ReportCard[] = [
  {
    id: 'monthly-tax',
    titleKey: 'admin.reports.monthlyTax.title',
    descriptionKey: 'admin.reports.monthlyTax.description',
    icon: <BarChartIcon fontSize="large" />,
    color: 'primary',
  },
  {
    id: 'sequences',
    titleKey: 'admin.reports.sequences.title',
    descriptionKey: 'admin.reports.sequences.description',
    icon: <VpnKeyIcon fontSize="large" />,
    color: 'info',
  },
  {
    id: 'pending-invoices',
    titleKey: 'admin.reports.pendingQueue.title',
    descriptionKey: 'admin.reports.pendingQueue.description',
    icon: <HourglassEmptyIcon fontSize="large" />,
    color: 'warning',
  },
  {
    id: 'occupancy',
    titleKey: 'admin.reports.occupancy.title',
    descriptionKey: 'admin.reports.occupancy.description',
    icon: <TrendingUpIcon fontSize="large" />,
    color: 'success',
  },
  {
    id: 'night-audit',
    titleKey: 'admin.reports.nightAudit.title',
    descriptionKey: 'admin.reports.nightAudit.description',
    icon: <NightsStayIcon fontSize="large" />,
    color: 'secondary',
  },
  {
    id: 'arrivals-departures',
    titleKey: 'admin.reports.arrivalsDepartures.title',
    descriptionKey: 'admin.reports.arrivalsDepartures.description',
    icon: <FlightLandIcon fontSize="large" />,
    color: 'primary',
  },
];

const REPORT_COMPONENTS: Record<ReportId, React.ComponentType> = {
  'monthly-tax': MonthlyTaxReport,
  'sequences': SequenceManagement,
  'pending-invoices': PendingInvoiceQueue,
  'occupancy': OccupancyReport,
  'night-audit': NightAuditReport,
  'arrivals-departures': ArrivalsDeparturesReport,
};

interface ReportsPageProps {
  reportId?: ReportId;
}

const ReportsPage: React.FC<ReportsPageProps> = ({ reportId: propReportId }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const params = useParams<{ reportId?: string }>();
  const activeReportId = (propReportId ?? params.reportId) as ReportId | undefined;

  // Render individual report
  if (activeReportId && REPORT_COMPONENTS[activeReportId]) {
    const ReportComponent = REPORT_COMPONENTS[activeReportId];
    return (
      <AdminLayout>
        <Box>
          <Button
            size="small"
            startIcon={<ArrowBackIcon />}
            onClick={() => navigate('/admin/reports')}
            sx={{ mb: 2 }}
          >
            {t('admin.reports.backToReports')}
          </Button>
          <ReportComponent />
        </Box>
      </AdminLayout>
    );
  }

  // Hub view — grid of report cards
  return (
    <AdminLayout>
      <Box>
        <Stack direction="row" alignItems="center" spacing={1.5} mb={3}>
          <AssessmentIcon color="primary" sx={{ fontSize: 32 }} />
          <Box>
            <Typography variant="h5" fontWeight={700}>
              {t('admin.reports.title')}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {t('admin.reports.subtitle')}
            </Typography>
          </Box>
        </Stack>

        <Grid container spacing={3}>
          {REPORT_CARDS.map((card) => (
            <Grid item xs={12} sm={6} md={4} key={card.id}>
              <Card
                variant="outlined"
                sx={{
                  height: '100%',
                  display: 'flex',
                  flexDirection: 'column',
                  transition: 'box-shadow 0.2s, border-color 0.2s',
                  '&:hover': {
                    boxShadow: 3,
                    borderColor: `${card.color}.main`,
                  },
                }}
              >
                <CardContent sx={{ flexGrow: 1 }}>
                  <Stack
                    direction="row"
                    alignItems="flex-start"
                    justifyContent="space-between"
                    mb={2}
                  >
                    <Box
                      sx={{
                        p: 1.5,
                        borderRadius: 2,
                        bgcolor: `${card.color}.50`,
                        color: `${card.color}.main`,
                        display: 'flex',
                      }}
                    >
                      {card.icon}
                    </Box>
                    {card.badgeKey && (
                      <Chip label={t(card.badgeKey)} color={card.color} size="small" />
                    )}
                  </Stack>
                  <Typography variant="h6" fontWeight={700} mb={0.5}>
                    {t(card.titleKey)}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {t(card.descriptionKey)}
                  </Typography>
                </CardContent>
                <CardActions sx={{ px: 2, pb: 2 }}>
                  <Button
                    variant="contained"
                    color={card.color}
                    endIcon={<ArrowForwardIcon />}
                    onClick={() => navigate(`/admin/reports/${card.id}`)}
                    fullWidth
                  >
                    {t('admin.reports.openReport')}
                  </Button>
                </CardActions>
              </Card>
            </Grid>
          ))}
        </Grid>
      </Box>
    </AdminLayout>
  );
};

export default ReportsPage;
