import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grid,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import dayjs from 'dayjs';
import AdminLayout from '../../components/admin/AdminLayout';
import SectionTitle from '../../components/admin/SectionTitle';
import { cashierClosuresService, CashierClosure } from '../../services/api';

const DEFAULT_DENOMINATIONS = [2000, 1000, 500, 200, 100, 50, 25, 10, 5, 1];

const formatMoney = (value: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(value || 0));

const CashierClosuresPage: React.FC = () => {
  const [closures, setClosures] = useState<CashierClosure[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [from, setFrom] = useState<string>(dayjs().subtract(30, 'day').format('YYYY-MM-DD'));
  const [to, setTo] = useState<string>(dayjs().format('YYYY-MM-DD'));

  const [generateOpen, setGenerateOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [preview, setPreview] = useState<{
    periodStart: string;
    periodEnd: string;
    paymentTotals: { cash: number; card: number; transfer: number; check: number; total: number };
    denominations: number[];
  } | null>(null);
  const [cashDistribution, setCashDistribution] = useState<Record<string, number>>({});

  const denominations = useMemo(() => preview?.denominations || DEFAULT_DENOMINATIONS, [preview]);

  const loadClosures = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await cashierClosuresService.getClosures({ from, to });
      setClosures(res.data.data || []);
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Failed to load cashier closures');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadClosures();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openGenerate = async () => {
    try {
      setError(null);
      const res = await cashierClosuresService.getPreview();
      const data = res.data.data;
      if (!data) return;
      setPreview(data);
      const initial: Record<string, number> = {};
      (data.denominations || DEFAULT_DENOMINATIONS).forEach((d) => { initial[String(d)] = 0; });
      setCashDistribution(initial);
      setGenerateOpen(true);
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Failed to build closure preview');
    }
  };

  const createClosure = async () => {
    try {
      setGenerating(true);
      await cashierClosuresService.createClosure({ cashDistribution });
      setGenerateOpen(false);
      setPreview(null);
      await loadClosures();
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Failed to create cashier closure');
    } finally {
      setGenerating(false);
    }
  };

  const getCashDeclared = () =>
    denominations.reduce((sum, denomination) => {
      const count = Number(cashDistribution[String(denomination)] || 0);
      return sum + (denomination * count);
    }, 0);

  const printClosure = (closure: CashierClosure) => {
    const popup = window.open('', '_blank', 'width=900,height=700');
    if (!popup) return;

    const cashierName = `${closure.user?.firstName || ''} ${closure.user?.lastName || ''}`.trim() || 'Cashier';
    const distributionRows = (closure.cashDistribution || [])
      .map(item => `<tr><td>${item.denomination}</td><td>${item.count}</td><td>${formatMoney(item.subtotal)}</td></tr>`)
      .join('');

    popup.document.write(`
      <html>
        <head>
          <title>Cashier Closure</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 24px; color: #111; }
            h1, h2 { margin: 0 0 8px 0; }
            .meta { margin-bottom: 16px; }
            table { width: 100%; border-collapse: collapse; margin-top: 12px; }
            th, td { border: 1px solid #ccc; padding: 8px; text-align: left; }
            th { background: #f5f5f5; }
            .section { margin-top: 20px; }
            .footer { margin-top: 28px; }
          </style>
        </head>
        <body>
          <h1>Cashier Closure</h1>
          <div class="meta">
            <div><strong>Period:</strong> ${dayjs(closure.periodStart).format('YYYY-MM-DD HH:mm')} - ${dayjs(closure.periodEnd).format('YYYY-MM-DD HH:mm')}</div>
            <div><strong>Created:</strong> ${dayjs(closure.createdAt).format('YYYY-MM-DD HH:mm')}</div>
          </div>

          <div class="section">
            <h2>Payments Summary</h2>
            <table>
              <tr><th>Cash</th><th>Card</th><th>Transfer</th><th>Check</th><th>Total</th></tr>
              <tr>
                <td>${formatMoney(closure.paymentTotals.cash)}</td>
                <td>${formatMoney(closure.paymentTotals.card)}</td>
                <td>${formatMoney(closure.paymentTotals.transfer)}</td>
                <td>${formatMoney(closure.paymentTotals.check)}</td>
                <td>${formatMoney(closure.paymentTotals.total)}</td>
              </tr>
            </table>
          </div>

          <div class="section">
            <h2>Cash Distribution</h2>
            <table>
              <tr><th>Denomination</th><th>Count</th><th>Subtotal</th></tr>
              ${distributionRows}
            </table>
          </div>

          <div class="footer">
            <div><strong>Cashier:</strong> ${cashierName}</div>
            <div><strong>Period End:</strong> ${dayjs(closure.periodEnd).format('YYYY-MM-DD HH:mm')}</div>
          </div>
        </body>
      </html>
    `);
    popup.document.close();
    popup.focus();
    popup.print();
  };

  return (
    <AdminLayout>
      <Box>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 3 }}>
          <SectionTitle title="Cashier Closures" />
          <Button variant="contained" onClick={openGenerate}>Generate Closure</Button>
        </Box>

        <Paper sx={{ p: 2, mb: 2 }}>
          <Grid container spacing={2} alignItems="center">
            <Grid item xs={12} sm={4}>
              <TextField label="From" type="date" value={from} onChange={(e) => setFrom(e.target.value)} fullWidth InputLabelProps={{ shrink: true }} />
            </Grid>
            <Grid item xs={12} sm={4}>
              <TextField label="To" type="date" value={to} onChange={(e) => setTo(e.target.value)} fullWidth InputLabelProps={{ shrink: true }} />
            </Grid>
            <Grid item xs={12} sm={4}>
              <Button variant="outlined" onClick={loadClosures}>Apply Filters</Button>
            </Grid>
          </Grid>
        </Paper>

        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        <TableContainer component={Paper}>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Period Start</TableCell>
                <TableCell>Period End</TableCell>
                <TableCell align="right">Cash</TableCell>
                <TableCell align="right">Card</TableCell>
                <TableCell align="right">Transfer</TableCell>
                <TableCell align="right">Check</TableCell>
                <TableCell align="right">Total</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={8} align="center"><CircularProgress size={24} /></TableCell></TableRow>
              ) : closures.length === 0 ? (
                <TableRow><TableCell colSpan={8} align="center">No closures found</TableCell></TableRow>
              ) : closures.map((closure) => (
                <TableRow key={closure._id}>
                  <TableCell>{dayjs(closure.periodStart).format('YYYY-MM-DD HH:mm')}</TableCell>
                  <TableCell>{dayjs(closure.periodEnd).format('YYYY-MM-DD HH:mm')}</TableCell>
                  <TableCell align="right">{formatMoney(closure.paymentTotals.cash)}</TableCell>
                  <TableCell align="right">{formatMoney(closure.paymentTotals.card)}</TableCell>
                  <TableCell align="right">{formatMoney(closure.paymentTotals.transfer)}</TableCell>
                  <TableCell align="right">{formatMoney(closure.paymentTotals.check)}</TableCell>
                  <TableCell align="right">{formatMoney(closure.paymentTotals.total)}</TableCell>
                  <TableCell align="right">
                    <Button size="small" onClick={() => printClosure(closure)}>Print</Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>

        <Dialog open={generateOpen} onClose={() => setGenerateOpen(false)} maxWidth="md" fullWidth>
          <DialogTitle>Generate Closure</DialogTitle>
          <DialogContent>
            {preview && (
              <Box sx={{ display: 'grid', gap: 2, mt: 1 }}>
                <Typography variant="body2">Period: {dayjs(preview.periodStart).format('YYYY-MM-DD HH:mm')} - {dayjs(preview.periodEnd).format('YYYY-MM-DD HH:mm')}</Typography>
                <Paper variant="outlined" sx={{ p: 2 }}>
                  <Typography variant="subtitle2">Payments by Method</Typography>
                  <Typography>Cash: {formatMoney(preview.paymentTotals.cash)}</Typography>
                  <Typography>Card: {formatMoney(preview.paymentTotals.card)}</Typography>
                  <Typography>Transfer: {formatMoney(preview.paymentTotals.transfer)}</Typography>
                  <Typography>Check: {formatMoney(preview.paymentTotals.check)}</Typography>
                  <Typography fontWeight={700}>Total: {formatMoney(preview.paymentTotals.total)}</Typography>
                </Paper>

                <Typography variant="subtitle2">Cash Distribution</Typography>
                <Grid container spacing={2}>
                  {denominations.map((denomination) => (
                    <Grid item xs={12} sm={6} md={4} key={denomination}>
                      <TextField
                        label={`$${denomination}`}
                        type="number"
                        inputProps={{ min: 0 }}
                        value={cashDistribution[String(denomination)] || 0}
                        onChange={(e) => setCashDistribution(prev => ({ ...prev, [String(denomination)]: Math.max(0, Number(e.target.value || 0)) }))}
                        fullWidth
                      />
                    </Grid>
                  ))}
                </Grid>
                <Typography variant="body2">Cash Counted: {formatMoney(getCashDeclared())}</Typography>
              </Box>
            )}
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setGenerateOpen(false)}>Cancel</Button>
            <Button variant="contained" onClick={createClosure} disabled={generating || !preview}>Confirm</Button>
          </DialogActions>
        </Dialog>
      </Box>
    </AdminLayout>
  );
};

export default CashierClosuresPage;
