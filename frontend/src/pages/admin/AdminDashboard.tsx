import React, { useState, useEffect } from 'react';
import {
  Container,
  Typography,
  Box,
  Grid,
  Paper,
  Button,
  Card,
  CardContent,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
} from '@mui/material';
import {
  Hotel,
  People,
  BookOnline,
  AttachMoney,
  TrendingUp,
  Add,
  Visibility,
} from '@mui/icons-material';
import { useAuth } from '../../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { roomsService, reservationsService } from '../../services/api';
import AdminLayout from '../../components/admin/AdminLayout';
import { useTranslation } from 'react-i18next';
import { formatMoney } from '../../utils/currency';

interface DashboardStats {
  totalRooms: number;
  totalReservations: number;
  totalUsers: number;
  monthlyRevenue: number;
  occupancyRate: number;
}

const AdminDashboard: React.FC = () => {
  const { user, permissions } = useAuth();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [stats, setStats] = useState<DashboardStats>({
    totalRooms: 0,
    totalReservations: 0,
    totalUsers: 0,
    monthlyRevenue: 0,
    occupancyRate: 0,
  });
  const [rooms, setRooms] = useState<any[]>([]);
  const [reservations, setReservations] = useState<any[]>([]);

  // Access handling: admin (or admin.dashboard) sees dashboard; otherwise redirect to first permitted admin section
  useEffect(() => {
    if (!user) {
      navigate('/login');
      return;
    }
    const perms = permissions || [];
    if (user.role === 'admin' || perms.includes('admin.dashboard') || perms.includes('admin.access')) {
      loadDashboardData();
      return;
    }
    const permToPath: { key: string; path: string }[] = [
      { key: 'admin.schedule', path: '/admin/schedule' },
      { key: 'admin.accommodations', path: '/admin/accommodations' },
      { key: 'admin.reservations', path: '/admin/reservations' },
      { key: 'admin.rooms', path: '/admin/rooms' },
      { key: 'admin.media', path: '/admin/media' },
      { key: 'admin.users', path: '/admin/users' },
      { key: 'admin.roles', path: '/admin/roles' },
      { key: 'admin.eventTypes', path: '/admin/event-types' },
      { key: 'admin.pricing', path: '/admin/pricing' },
      { key: 'admin.analytics', path: '/admin/analytics' },
      { key: 'admin.settings', path: '/admin/settings' },
    ];
    const first = permToPath.find(p => perms.includes(p.key));
    if (first) {
      navigate(first.path);
      return;
    }
    // No admin permissions; go to login
    navigate('/login');
  }, [user, permissions, navigate]);

  const loadDashboardData = async () => {
    try {
      // Load rooms
      const roomsResponse = await roomsService.getRooms({ limit: 10 });
      if (roomsResponse.data.success) {
        setRooms(roomsResponse.data.data?.rooms || []);
      }

      // Load reservations
      const reservationsResponse = await reservationsService.getUserReservations();
      if (reservationsResponse.data.success) {
        setReservations(reservationsResponse.data.data || []);
      }

      // Calculate mock stats (in real app, this would come from backend)
      setStats({
        totalRooms: roomsResponse.data.data?.rooms?.length || 0,
        totalReservations: reservationsResponse.data.data?.length || 0,
        totalUsers: 2, // Mock data
        monthlyRevenue: 15420,
        occupancyRate: 78,
      });
    } catch (error) {
      console.error('Error loading dashboard data:', error);
    }
  };

  const StatCard = ({ title, value, icon, color }: any) => (
    <Card sx={{ height: '100%' }}>
      <CardContent>
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
          <Box sx={{ color: color, mr: 2 }}>{icon}</Box>
          <Typography color="textSecondary" gutterBottom variant="h6">
            {title}
          </Typography>
        </Box>
        <Typography variant="h4" component="div">
          {value}
        </Typography>
      </CardContent>
    </Card>
  );

  if (!user || !(user.role === 'admin' || (permissions || []).includes('admin.dashboard') || (permissions || []).includes('admin.access'))) {
    return null;
  }

  return (
    <AdminLayout>
    <Container maxWidth="xl" sx={{ py: 4 }}>
      <Typography variant="h3" component="h1" gutterBottom>
        {t('admin.dashboard.title')}
      </Typography>
      <Typography variant="h6" color="text.secondary" sx={{ mb: 4 }}>
        {t('admin.dashboard.welcome', { name: user?.firstName || 'Admin' })}
      </Typography>

      {/* Dashboard Stats */}
      <Grid container spacing={3} sx={{ mb: 4 }}>
        <Grid item xs={12} sm={6} md={2.4}>
          <StatCard
            title={t('admin.dashboard.stats.totalRooms')}
            value={stats.totalRooms}
            icon={<Hotel fontSize="large" />}
            color="primary.main"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={2.4}>
          <StatCard
            title={t('admin.dashboard.stats.reservations')}
            value={stats.totalReservations}
            icon={<BookOnline fontSize="large" />}
            color="secondary.main"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={2.4}>
          <StatCard
            title={t('admin.dashboard.stats.totalUsers')}
            value={stats.totalUsers}
            icon={<People fontSize="large" />}
            color="info.main"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={2.4}>
          <StatCard
            title={t('admin.dashboard.stats.monthlyRevenue')}
            value={formatMoney(stats.monthlyRevenue)}
            icon={<AttachMoney fontSize="large" />}
            color="success.main"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={2.4}>
          <StatCard
            title={t('admin.dashboard.stats.occupancyRate')}
            value={`${stats.occupancyRate}%`}
            icon={<TrendingUp fontSize="large" />}
            color="warning.main"
          />
        </Grid>
      </Grid>

      {/* Quick Actions */}
      <Paper sx={{ p: 3, mb: 4 }}>
        <Typography variant="h5" gutterBottom>
          {t('admin.dashboard.quickActions.title')}
        </Typography>
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
          <Button
            variant="contained"
            startIcon={<Add />}
            onClick={() => navigate('/admin/rooms')}
          >
            {t('admin.dashboard.quickActions.manageRooms')}
          </Button>
          <Button
            variant="outlined"
            startIcon={<BookOnline />}
            onClick={() => navigate('/admin/reservations')}
          >
            {t('admin.dashboard.quickActions.manageReservations')}
          </Button>
          <Button
            variant="outlined"
            startIcon={<Hotel />}
            onClick={() => navigate('/admin/amenities')}
          >
            {t('admin.dashboard.quickActions.manageAmenities')}
          </Button>
          <Button
            variant="outlined"
            startIcon={<People />}
            onClick={() => navigate('/admin/users')}
          >
            {t('admin.dashboard.quickActions.manageUsers')}
          </Button>
          <Button
            variant="outlined"
            startIcon={<Visibility />}
            onClick={() => navigate('/admin/reports')}
          >
            {t('admin.dashboard.quickActions.viewReports')}
          </Button>
        </Box>
      </Paper>

      {/* Recent Rooms */}
      <Grid container spacing={3}>
        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 3 }}>
            <Typography variant="h5" gutterBottom>
              {t('admin.dashboard.roomsOverview.title')}
            </Typography>
            <TableContainer>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>{t('admin.dashboard.roomsOverview.table.roomName')}</TableCell>
                    <TableCell>{t('admin.dashboard.roomsOverview.table.status')}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rooms.slice(0, 5).map((room) => (
                    <TableRow key={room._id}>
                      <TableCell>{room.name}</TableCell>
                      <TableCell>
                        <Chip
                          label={t(`admin.rooms.statusLabels.${room.status || 'inactive'}`)}
                          color={room.status === 'active' ? 'success' : 'default'}
                          size="small"
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Paper>
        </Grid>

        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 3 }}>
            <Typography variant="h5" gutterBottom>
              {t('admin.dashboard.recentReservations.title')}
            </Typography>
            <TableContainer>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>{t('admin.dashboard.recentReservations.table.guest')}</TableCell>
                    <TableCell>{t('admin.dashboard.recentReservations.table.checkin')}</TableCell>
                    <TableCell>{t('admin.dashboard.recentReservations.table.status')}</TableCell>
                    <TableCell>{t('admin.dashboard.recentReservations.table.total')}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {reservations.slice(0, 5).map((reservation) => (
                    <TableRow key={reservation._id}>
                      <TableCell>
                        {reservation.user && typeof reservation.user === 'object'
                          ? `${reservation.user.firstName} ${reservation.user.lastName}`
                          : reservation.guestName && reservation.guestName.firstName
                            ? `${reservation.guestName.firstName} ${reservation.guestName.lastName || ''}`.trim()
                            : t('admin.dashboard.recentReservations.guestFallback')}
                      </TableCell>
                      <TableCell>
                        {new Date(reservation.checkInDate).toLocaleDateString()}
                      </TableCell>
                      <TableCell>
                        <Chip
                          label={t(`admin.reservations.statusLabels.${reservation.status}`)}
                          color={
                            reservation.status === 'confirmed' ? 'success' :
                              reservation.status === 'pending' ? 'warning' :
                                reservation.status === 'cancelled' ? 'error' : 'default'
                          }
                          size="small"
                        />
                      </TableCell>
                      <TableCell>{formatMoney(reservation.totalPrice || 0)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Paper>
        </Grid>
      </Grid>
    </Container>
    </AdminLayout>
  );
};

export default AdminDashboard;
