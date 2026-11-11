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
import SpeedIcon from '@mui/icons-material/Speed';
import InsightsIcon from '@mui/icons-material/Insights';
import PieChartIcon from '@mui/icons-material/PieChart';
import EventNoteIcon from '@mui/icons-material/EventNote';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import AdminLayout from '../../components/admin/AdminLayout';
import FiscalTaxReportTab from '../../components/fiscal/FiscalTaxReportTab';
import FiscalSequencesTab from '../../components/fiscal/FiscalSequencesTab';
import FiscalDocumentsTab from '../../components/fiscal/FiscalDocumentsTab';
import { useFiscalAccess } from '../../components/fiscal/useFiscalAccess';
import OccupancyReport from '../../components/admin/reports/OccupancyReport';
import NightAuditReport from '../../components/admin/reports/NightAuditReport';
import ArrivalsDeparturesReport from '../../components/admin/reports/ArrivalsDeparturesReport';
import ManagerFlashReport from '../../components/admin/reports/ManagerFlashReport';
import ForecastReport from '../../components/admin/reports/ForecastReport';
import SegmentationReport from '../../components/admin/reports/SegmentationReport';
import BookingInsightsReport from '../../components/admin/reports/BookingInsightsReport';

type ReportId =
  | 'manager-flash' | 'forecast' | 'occupancy' | 'segmentation' | 'booking-insights'
  | 'night-audit' | 'arrivals-departures'
  | 'monthly-tax' | 'sequences' | 'pending-invoices';

type ReportGroup = 'management' | 'frontOffice' | 'fiscal';
const GROUPS: ReportGroup[] = ['management', 'frontOffice', 'fiscal'];

interface ReportCard {
  id: ReportId;
  group: ReportGroup;
  titleKey: string;
  descriptionKey: string;
  icon: React.ReactNode;
  color: 'primary' | 'warning' | 'info' | 'success' | 'secondary';
  badgeKey?: string;
}

const REPORT_CARDS: ReportCard[] = [
  {
    id: 'manager-flash',
    group: 'management',
    titleKey: 'admin.reports.flash.title',
    descriptionKey: 'admin.reports.flash.description',
    icon: <SpeedIcon fontSize="large" />,
    color: 'primary',
  },
  {
    id: 'forecast',
    group: 'management',
    titleKey: 'admin.reports.forecast.title',
    descriptionKey: 'admin.reports.forecast.description',
    icon: <InsightsIcon fontSize="large" />,
    color: 'primary',
  },
  {
    id: 'occupancy',
    group: 'management',
    titleKey: 'admin.reports.occupancy.title',
    descriptionKey: 'admin.reports.occupancy.description',
    icon: <TrendingUpIcon fontSize="large" />,
    color: 'primary',
  },
  {
    id: 'segmentation',
    group: 'management',
    titleKey: 'admin.reports.segmentation.title',
    descriptionKey: 'admin.reports.segmentation.description',
    icon: <PieChartIcon fontSize="large" />,
    color: 'primary',
  },
  {
    id: 'booking-insights',
    group: 'management',
    titleKey: 'admin.reports.insights.title',
    descriptionKey: 'admin.reports.insights.description',
    icon: <EventNoteIcon fontSize="large" />,
    color: 'primary',
  },
  {
    id: 'night-audit',
    group: 'frontOffice',
    titleKey: 'admin.reports.nightAudit.title',
    descriptionKey: 'admin.reports.nightAudit.description',
    icon: <NightsStayIcon fontSize="large" />,
    color: 'secondary',
  },
  {
    id: 'arrivals-departures',
    group: 'frontOffice',
    titleKey: 'admin.reports.arrivalsDepartures.title',
    descriptionKey: 'admin.reports.arrivalsDepartures.description',
    icon: <FlightLandIcon fontSize="large" />,
    color: 'secondary',
  },
  {
    id: 'monthly-tax',
    group: 'fiscal',
    titleKey: 'admin.reports.monthlyTax.title',
    descriptionKey: 'admin.reports.monthlyTax.description',
    icon: <BarChartIcon fontSize="large" />,
    color: 'info',
  },
  {
    id: 'sequences',
    group: 'fiscal',
    titleKey: 'admin.reports.sequences.title',
    descriptionKey: 'admin.reports.sequences.description',
    icon: <VpnKeyIcon fontSize="large" />,
    color: 'info',
  },
  {
    id: 'pending-invoices',
    group: 'fiscal',
    titleKey: 'admin.reports.pendingQueue.title',
    descriptionKey: 'admin.reports.pendingQueue.description',
    icon: <HourglassEmptyIcon fontSize="large" />,
    color: 'warning',
  },
];

/** The e-CF reports in this hub are the Fiscal Center's own tabs, shown here with the access of the current app. */
const SequencesReport: React.FC = () => <FiscalSequencesTab canManage={useFiscalAccess().canManage} />;
const PendingDocumentsReport: React.FC = () => {
  const { canIssue } = useFiscalAccess();
  return <FiscalDocumentsTab canIssue={canIssue} initialEstado="attention" />;
};

const REPORT_COMPONENTS: Record<ReportId, React.ComponentType> = {
  'manager-flash': ManagerFlashReport,
  'forecast': ForecastReport,
  'segmentation': SegmentationReport,
  'booking-insights': BookingInsightsReport,
  'monthly-tax': FiscalTaxReportTab,
  'sequences': SequencesReport,
  'pending-invoices': PendingDocumentsReport,
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

        {GROUPS.map((group) => (
          <Box key={group} mb={4}>
            <Typography variant="overline" color="text.secondary" fontWeight={700} sx={{ letterSpacing: 1 }}>
              {t(`admin.reports.groups.${group}.title`)}
            </Typography>
            <Typography variant="body2" color="text.secondary" mb={1.5}>
              {t(`admin.reports.groups.${group}.description`)}
            </Typography>
            <Grid container spacing={3}>
              {REPORT_CARDS.filter((card) => card.group === group).map((card) => (
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
        ))}
      </Box>
    </AdminLayout>
  );
};

export default ReportsPage;
