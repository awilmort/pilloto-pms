import React, { useEffect, useMemo, useState } from 'react';
import { Container, Typography, Paper, Box, TextField, Button, Table, TableBody, TableCell, TableContainer, TableHead, TableRow } from '@mui/material';
import dayjs from 'dayjs';
import { useTranslation } from 'react-i18next';
import AdminLayout from '../../components/admin/AdminLayout';
import { adminService } from '../../services/api';

interface SalesmanStat {
  id: string;
  name: string;
  email: string;
  role: string;
  totalGuests: number;
  bookings: number;
}

const Commissions: React.FC = () => {
  const { t } = useTranslation();
  const [from, setFrom] = useState<string>(dayjs().format('YYYY-MM-DD'));
  const [to, setTo] = useState<string>(dayjs().format('YYYY-MM-DD'));
  const [name, setName] = useState<string>('');
  const [email, setEmail] = useState<string>('');
  const [rows, setRows] = useState<SalesmanStat[]>([]);
  const today = useMemo(() => dayjs().format('YYYY-MM-DD'), []);

  const loadData = async () => {
    try {
      const res = await adminService.getCommissions({ from, to, name: name || undefined, email: email || undefined });
      if (res.data.success) {
        setRows(res.data.data.salesmen || []);
      }
    } catch (e) {
      console.error('Commissions fetch error:', e);
    }
  };

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyFilters = () => {
    const fromClamped = dayjs(from).isAfter(today) ? today : from;
    const toClamped = dayjs(to).isAfter(today) ? today : to;
    setFrom(fromClamped);
    setTo(toClamped);
    setTimeout(loadData, 0);
  };

  return (
    <AdminLayout>
      <Container maxWidth="xl" sx={{ py: 4 }}>
        <Typography variant="h3" component="h1" gutterBottom>
          {t('admin.commissions.title')}
        </Typography>

        {/* Filters */}
        <Paper sx={{ p: 3, mb: 3 }}>
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
            <TextField
              label={t('admin.commissions.filters.from')}
              type="date"
              value={from}
              inputProps={{ max: today }}
              onChange={(e) => setFrom(e.target.value)}
            />
            <TextField
              label={t('admin.commissions.filters.to')}
              type="date"
              value={to}
              inputProps={{ max: today }}
              onChange={(e) => setTo(e.target.value)}
            />
            <TextField
              label={t('admin.commissions.filters.name')}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <TextField
              label={t('admin.commissions.filters.email')}
              type="text"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <Button variant="contained" onClick={applyFilters}>
              {t('admin.commissions.filters.apply')}
            </Button>
          </Box>
        </Paper>

        {/* Table */}
        <TableContainer component={Paper}>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>{t('admin.commissions.table.name')}</TableCell>
                <TableCell>{t('admin.commissions.table.email')}</TableCell>
                <TableCell>{t('admin.commissions.table.totalGuests')}</TableCell>
                <TableCell>{t('admin.commissions.table.bookings')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>{r.name}</TableCell>
                  <TableCell>{r.email}</TableCell>
                  <TableCell>{r.totalGuests.toLocaleString()}</TableCell>
                  <TableCell>{r.bookings.toLocaleString()}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Container>
    </AdminLayout>
  );
};

export default Commissions;
