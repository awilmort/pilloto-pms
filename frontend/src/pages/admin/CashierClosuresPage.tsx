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
import { useTranslation } from 'react-i18next';
import AdminLayout from '../../components/admin/AdminLayout';
import SectionTitle from '../../components/admin/SectionTitle';
import { cashierClosuresService, CashierClosure } from '../../services/api';

const DEFAULT_DENOMINATIONS = [2000, 1000, 500, 200, 100, 50, 25, 10, 5, 1];

const formatMoney = (value: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(value || 0));

const CashierClosuresPage: React.FC = () => {
  const { t } = useTranslation();
  const [closures, setClosures] = useState<CashierClosure[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [from, setFrom] = useState<string>(dayjs().subtract(30, 'day').format('YYYY-MM-DD'));
  const [to, setTo] = useState<string>(dayjs().format('YYYY-MM-DD'));

  const [generateOpen, setGenerateOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [note, setNote] = useState<string>('');
  const [shiftStart, setShiftStart] = useState<string>('');
  const [shiftEnd, setShiftEnd] = useState<string>('');
  const [preview, setPreview] = useState<{
    periodStart: string;
    periodEnd: string;
    paymentTotals: { cash: number; card: number; transfer: number; check: number; total: number };
    denominations: number[];
  } | null>(null);
  const [cashDistribution, setCashDistribution] = useState<Record<string, string>>({});

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

  const openGenerate = () => {
    const today = dayjs().format('YYYY-MM-DD');
    setShiftStart(`${today}T08:00`);
    setShiftEnd(`${today}T17:00`);
    setPreview(null);
    setCashDistribution({});
    setNote('');
    setError(null);
    setGenerateOpen(true);
  };

  const loadPreview = async () => {
    try {
      setPreviewLoading(true);
      setError(null);
      const res = await cashierClosuresService.getPreview({ shiftStart, shiftEnd });
      const data = res.data.data;
      if (!data) return;
      setPreview(data);
      const initial: Record<string, string> = {};
      (data.denominations || DEFAULT_DENOMINATIONS).forEach((d) => { initial[String(d)] = ''; });
      setCashDistribution(initial);
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Failed to build closure preview');
    } finally {
      setPreviewLoading(false);
    }
  };
  const createClosure = async () => {
    try {
      setGenerating(true);
      const numericDistribution: Record<string, number> = {};
      Object.entries(cashDistribution).forEach(([k, v]) => {
        numericDistribution[k] = Math.max(0, Number(v) || 0);
      });
      await cashierClosuresService.createClosure({ shiftStart, shiftEnd, cashDistribution: numericDistribution, note: note.trim() || undefined });
      setGenerateOpen(false);
      setPreview(null);
      setNote('');
      await loadClosures();
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Failed to create cashier closure');
    } finally {
      setGenerating(false);
    }
  };

  const getCashDeclared = () =>
    denominations.reduce((sum, denomination) => {
      const count = Math.max(0, Number(cashDistribution[String(denomination)] || 0));
      return sum + (denomination * count);
    }, 0);

  const printClosure = (closure: CashierClosure) => {
    const popup = window.open('', '_blank', 'width=900,height=700');
    if (!popup) return;

    const cashierName = `${closure.user?.firstName || ''} ${closure.user?.lastName || ''}`.trim() || t('admin.cashierClosures.cashier');
    const distributionRows = (closure.cashDistribution || [])
      .filter(item => item.count > 0)
      .map(item => `<tr><td>${item.denomination}</td><td>${item.count}</td><td>${formatMoney(item.subtotal)}</td></tr>`)
      .join('');
    const noteRow = closure.note
      ? `<div class="section"><strong>${t('admin.cashierClosures.note')}:</strong> ${closure.note}</div>`
      : '';

    popup.document.write(`
      <html>
        <head>
          <title>${t('admin.cashierClosures.title')}</title>
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
          <h1>${t('admin.cashierClosures.title')}</h1>
          <div class="meta">
            <div><strong>${t('admin.cashierClosures.period')}:</strong> ${dayjs(closure.periodStart).format('YYYY-MM-DD HH:mm')} - ${dayjs(closure.periodEnd).format('YYYY-MM-DD HH:mm')}</div>
            <div><strong>${t('admin.cashierClosures.created')}:</strong> ${dayjs(closure.createdAt).format('YYYY-MM-DD HH:mm')}</div>
            <div><strong>${t('admin.cashierClosures.cashier')}:</strong> ${cashierName}</div>
          </div>

          <div class="section">
            <h2>${t('admin.cashierClosures.paymentsSummary')}</h2>
            <table>
              <tr>
                <th>${t('admin.cashierClosures.cash')}</th>
                <th>${t('admin.cashierClosures.card')}</th>
                <th>${t('admin.cashierClosures.transfer')}</th>
                <th>${t('admin.cashierClosures.check')}</th>
                <th>${t('admin.cashierClosures.total')}</th>
              </tr>
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
            <h2>${t('admin.cashierClosures.cashDistribution')}</h2>
            <table>
              <tr>
                <th>${t('admin.cashierClosures.denomination')}</th>
                <th>${t('admin.cashierClosures.count')}</th>
                <th>${t('admin.cashierClosures.subtotal')}</th>
              </tr>
              ${distributionRows}
            </table>
          </div>

          ${noteRow}
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
          <SectionTitle title={t('admin.cashierClosures.title')} />
          <Button variant="contained" onClick={openGenerate}>{t('admin.cashierClosures.generate')}</Button>
        </Box>

        <Paper sx={{ p: 2, mb: 2 }}>
          <Grid container spacing={2} alignItems="center">
            <Grid item xs={12} sm={4}>
              <TextField label={t('admin.cashierClosures.from')} type="date" value={from} onChange={(e) => setFrom(e.target.value)} fullWidth InputLabelProps={{ shrink: true }} />
            </Grid>
            <Grid item xs={12} sm={4}>
              <TextField label={t('admin.cashierClosures.to')} type="date" value={to} onChange={(e) => setTo(e.target.value)} fullWidth InputLabelProps={{ shrink: true }} />
            </Grid>
            <Grid item xs={12} sm={4}>
              <Button variant="outlined" onClick={loadClosures}>{t('admin.cashierClosures.applyFilters')}</Button>
            </Grid>
          </Grid>
        </Paper>

        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        <TableContainer component={Paper}>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>{t('admin.cashierClosures.periodStart')}</TableCell>
                <TableCell>{t('admin.cashierClosures.periodEnd')}</TableCell>
                <TableCell align="right">{t('admin.cashierClosures.cash')}</TableCell>
                <TableCell align="right">{t('admin.cashierClosures.card')}</TableCell>
                <TableCell align="right">{t('admin.cashierClosures.transfer')}</TableCell>
                <TableCell align="right">{t('admin.cashierClosures.check')}</TableCell>
                <TableCell align="right">{t('admin.cashierClosures.total')}</TableCell>
                <TableCell align="right">{t('admin.cashierClosures.actions')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={8} align="center"><CircularProgress size={24} /></TableCell></TableRow>
              ) : closures.length === 0 ? (
                <TableRow><TableCell colSpan={8} align="center">{t('admin.cashierClosures.noData')}</TableCell></TableRow>
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
                    <Button size="small" onClick={() => printClosure(closure)}>{t('admin.cashierClosures.print')}</Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>

        <Dialog open={generateOpen} onClose={() => { setGenerateOpen(false); setNote(''); }} maxWidth="md" fullWidth>
          <DialogTitle>{t('admin.cashierClosures.generate')}</DialogTitle>
          <DialogContent>
            <Box sx={{ display: 'grid', gap: 2, mt: 1 }}>
              <Grid container spacing={2}>
                <Grid item xs={12} sm={6}>
                  <TextField
                    label={t('admin.cashierClosures.shiftStart', 'Shift Start')}
                    type="datetime-local"
                    value={shiftStart}
                    onChange={(e) => { setShiftStart(e.target.value); setPreview(null); }}
                    InputLabelProps={{ shrink: true }}
                    fullWidth
                  />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <TextField
                    label={t('admin.cashierClosures.shiftEnd', 'Shift End')}
                    type="datetime-local"
                    value={shiftEnd}
                    onChange={(e) => { setShiftEnd(e.target.value); setPreview(null); }}
                    InputLabelProps={{ shrink: true }}
                    fullWidth
                  />
                </Grid>
              </Grid>
              <Box>
                <Button
                  variant="outlined"
                  onClick={loadPreview}
                  disabled={previewLoading || !shiftStart || !shiftEnd}
                >
                  {previewLoading ? <CircularProgress size={20} sx={{ mr: 1 }} /> : null}
                  {t('admin.cashierClosures.loadPreview', 'Load Preview')}
                </Button>
              </Box>

              {preview && (
                <>
                  <Paper variant="outlined" sx={{ p: 2 }}>
                    <Typography variant="subtitle2">{t('admin.cashierClosures.paymentsByMethod')}</Typography>
                    <Typography>{t('admin.cashierClosures.cash')}: {formatMoney(preview.paymentTotals.cash)}</Typography>
                    <Typography>{t('admin.cashierClosures.card')}: {formatMoney(preview.paymentTotals.card)}</Typography>
                    <Typography>{t('admin.cashierClosures.transfer')}: {formatMoney(preview.paymentTotals.transfer)}</Typography>
                    <Typography>{t('admin.cashierClosures.check')}: {formatMoney(preview.paymentTotals.check)}</Typography>
                    <Typography fontWeight={700}>{t('admin.cashierClosures.total')}: {formatMoney(preview.paymentTotals.total)}</Typography>
                  </Paper>

                  <Typography variant="subtitle2">{t('admin.cashierClosures.cashDistribution')}</Typography>
                  <Grid container spacing={2}>
                    {denominations.map((denomination) => (
                      <Grid item xs={12} sm={6} md={4} key={denomination}>
                        <TextField
                          label={`$${denomination}`}
                          type="number"
                          inputProps={{ min: 0, step: 1 }}
                          value={cashDistribution[String(denomination)] ?? ''}
                          onChange={(e) => setCashDistribution(prev => ({ ...prev, [String(denomination)]: e.target.value }))}
                          fullWidth
                        />
                      </Grid>
                    ))}
                  </Grid>
                  <Typography variant="body2">{t('admin.cashierClosures.cashCounted')}: {formatMoney(getCashDeclared())}</Typography>
                  <TextField
                    label={t('admin.cashierClosures.note')}
                    multiline
                    minRows={2}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    fullWidth
                  />
                </>
              )}
            </Box>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setGenerateOpen(false)}>{t('admin.cashierClosures.cancel')}</Button>
            <Button variant="contained" onClick={createClosure} disabled={generating || !preview}>{t('admin.cashierClosures.confirm')}</Button>
          </DialogActions>
        </Dialog>
      </Box>
    </AdminLayout>
  );
};

export default CashierClosuresPage;
