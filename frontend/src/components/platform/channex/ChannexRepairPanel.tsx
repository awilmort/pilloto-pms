/**
 * Platform console → tenant → Repair (plan 9.3; architecture §6.5): Pilloto room types and
 * rate plans beside the Channex objects of the tenant's property, with re-link to an existing
 * Channex id, recreate (rate plans), and "recreate rate plans" for a room type whose capacity
 * changed (`remap_required`). Loaded on demand: it calls Channex.
 */
import React, { useState } from 'react';
import {
  Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, MenuItem, Table, TableBody,
  TableCell, TableHead, TableRow, TextField, Typography,
} from '@mui/material';
import { platformChannexService, RepairRow, RepairView } from '../../../services/api';

const PROBLEM_LABEL: Record<string, string> = {
  not_synced: 'not in Channex', missing_in_channex: 'linked id missing in Channex', remap_required: 'remap required',
  error: 'last sync failed', wrong_room_type: 'under another room type',
};

type Confirm = { title: string; text: string; run: () => Promise<string> } | null;

const ChannexRepairPanel: React.FC<{ tenantId: string; active: boolean; onChanged?: () => void }> = ({ tenantId, active, onChanged }) => {
  const [view, setView] = useState<RepairView | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ severity: 'success' | 'error'; text: string } | null>(null);
  const [relink, setRelink] = useState<{ row: RepairRow; channexId: string } | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);

  const load = async () => {
    setLoading(true);
    setMessage(null);
    try { setView((await platformChannexService.repair(tenantId)).data.data ?? null); } catch (e: any) {
      setMessage({ severity: 'error', text: e?.response?.data?.message ?? 'Failed to load the repair screen.' });
    } finally { setLoading(false); }
  };

  const act = async (fn: () => Promise<string>) => {
    setBusy(true);
    setMessage(null);
    try { setMessage({ severity: 'success', text: await fn() }); onChanged?.(); } catch (e: any) {
      setMessage({ severity: 'error', text: e?.response?.data?.message ?? 'Action failed.' });
    } finally { setBusy(false); setConfirm(null); setRelink(null); }
  };

  /** Channex objects a row may be re-linked to: same kind; rate plans under the room type's Channex room type */
  const candidates = (row: RepairRow) => {
    if (!view) return [];
    if (row.kind === 'room_type') return view.channex.roomTypes;
    const rtLink = view.rows.find((r) => r.kind === 'room_type' && r.localId === row.roomTypeId)?.channexId;
    return view.channex.ratePlans.filter((o) => !rtLink || !o.roomTypeId || o.roomTypeId === rtLink);
  };
  const linkedTo = (channexId: string) => view?.rows.find((r) => r.channexId === channexId);

  return (
    <Box sx={{ mt: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
        <Typography variant="subtitle1" fontWeight={700} sx={{ flex: 1 }}>Repair mappings</Typography>
        <Button size="small" variant="outlined" disabled={!active || loading} onClick={load} startIcon={loading ? <CircularProgress size={14} /> : undefined}>
          {view ? 'Reload from Channex' : 'Load from Channex'}
        </Button>
      </Box>
      {message && <Alert severity={message.severity} sx={{ mb: 1 }} onClose={() => setMessage(null)}>{message.text}</Alert>}
      {!view && <Typography variant="caption" color="text.secondary">Compares Pilloto with the property's Channex room types and rate plans (calls Channex).</Typography>}
      {view && (
        <>
          <Box sx={{ overflowX: 'auto' }}>
            <Table size="small">
              <TableHead><TableRow>{['Kind', 'Pilloto', 'Capacity', 'Linked Channex object', 'Problems', ''].map((c) => <TableCell key={c}>{c}</TableCell>)}</TableRow></TableHead>
              <TableBody>
                {view.rows.map((r) => {
                  const remapPlans = r.kind === 'room_type' && view.rows.some((p) => p.kind === 'rate_plan' && p.roomTypeId === r.localId && p.problems.includes('remap_required'));
                  return (
                    <TableRow key={`${r.kind}-${r.localId}`} sx={{ bgcolor: r.problems.length ? 'rgba(237,108,2,0.06)' : undefined }}>
                      <TableCell>{r.kind === 'room_type' ? 'Room type' : 'Rate plan'}</TableCell>
                      <TableCell>{r.roomTypeName ? `${r.roomTypeName} · ` : ''}{r.name}</TableCell>
                      <TableCell>{r.capacity ?? '—'}</TableCell>
                      <TableCell>
                        {r.channexId ? (
                          <>
                            <Typography variant="caption" sx={{ fontFamily: 'monospace', display: 'block' }}>{r.channexId}</Typography>
                            <Typography variant="caption" color="text.secondary">{r.channexTitle ?? '(not found in Channex)'}</Typography>
                          </>
                        ) : '—'}
                      </TableCell>
                      <TableCell>
                        {r.problems.map((p) => <Chip key={p} size="small" color="warning" label={PROBLEM_LABEL[p] ?? p} sx={{ mr: 0.5, mb: 0.5 }} />)}
                        {r.error && <Typography variant="caption" color="error" display="block" sx={{ wordBreak: 'break-word' }}>{r.error}</Typography>}
                      </TableCell>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>
                        <Button size="small" disabled={busy} onClick={() => setRelink({ row: r, channexId: r.channexId ?? '' })}>Re-link…</Button>
                        {r.kind === 'rate_plan' && r.channexId && (
                          <Button size="small" color="warning" disabled={busy} onClick={() => setConfirm({
                            title: `Recreate “${r.name}” in Channex?`,
                            text: 'Pilloto forgets the current link and creates a new Channex rate plan with the current occupancy options, then resends its prices for 500 days. The old one is deleted if Channex allows it, otherwise closed (stop sell). The tenant must map the new rate plan in every OTA.',
                            run: async () => {
                              const res = await platformChannexService.recreate(tenantId, r.localId);
                              setView(res.data.data?.view ?? view);
                              return res.data.data?.oldDeleted ? 'Recreated; the old Channex rate plan was deleted.' : 'Recreated; the old Channex rate plan is still mapped in an OTA and was closed.';
                            },
                          })}>Recreate</Button>
                        )}
                        {remapPlans && (
                          <Button size="small" color="warning" variant="outlined" disabled={busy} onClick={() => setConfirm({
                            title: `Recreate the rate plans of “${r.name}”?`,
                            text: 'Every rate plan of this room type gets a new Channex rate plan with occupancy options 1..capacity. Old ones Channex cannot delete (still mapped in an OTA) are closed with one stop-sell call. The tenant then gets an alert to map the new rates in each channel.',
                            run: async () => {
                              const res = await platformChannexService.recreateRatePlans(tenantId, r.localId);
                              setView(res.data.data?.view ?? view);
                              return `${res.data.data?.recreated ?? 0} rate plan(s) recreated, ${res.data.data?.closed ?? 0} old one(s) closed.`;
                            },
                          })}>Recreate rate plans</Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Box>
          {(view.unlinked.roomTypes.length > 0 || view.unlinked.ratePlans.length > 0) && (
            <Box sx={{ mt: 1.5 }}>
              <Typography variant="subtitle2" fontWeight={700}>Channex objects not linked to Pilloto</Typography>
              {[...view.unlinked.roomTypes.map((o) => ({ ...o, kind: 'Room type' })), ...view.unlinked.ratePlans.map((o) => ({ ...o, kind: 'Rate plan' }))].map((o) => (
                <Typography key={o.id} variant="caption" display="block" sx={{ fontFamily: 'monospace' }}>
                  {o.kind}: {o.id} — {o.title}{o.occupancies?.length ? ` (occupancy ${o.occupancies.join(', ')})` : ''}{o.roomTypeId ? ` · room type ${o.roomTypeId}` : ''}
                </Typography>
              ))}
            </Box>
          )}
        </>
      )}

      <Dialog open={Boolean(relink)} onClose={() => setRelink(null)} fullWidth maxWidth="sm">
        <DialogTitle>Re-link “{relink?.row.name}”</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 2 }}>
            Point this {relink?.row.kind === 'room_type' ? 'room type' : 'rate plan'} at an existing Channex object of this property. Its values are then resent for 500 days.
          </DialogContentText>
          {relink && (
            <TextField select fullWidth label="Channex object" value={relink.channexId} onChange={(e) => setRelink({ ...relink, channexId: e.target.value })}>
              {candidates(relink.row).map((o) => {
                const other = linkedTo(o.id);
                const taken = Boolean(other && !(other.kind === relink.row.kind && other.localId === relink.row.localId));
                return (
                  <MenuItem key={o.id} value={o.id} disabled={taken}>
                    {o.title} — {o.id}{o.occupancies?.length ? ` (occ. ${o.occupancies.join(', ')})` : ''}{taken ? ` · linked to ${other!.name}` : ''}
                  </MenuItem>
                );
              })}
            </TextField>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRelink(null)}>Cancel</Button>
          <Button variant="contained" disabled={!relink?.channexId || relink.channexId === relink.row.channexId || busy}
            onClick={() => relink && act(async () => {
              const res = await platformChannexService.relink(tenantId, { kind: relink.row.kind, localId: relink.row.localId, channexId: relink.channexId });
              setView(res.data.data?.view ?? view);
              return `Re-linked; ${res.data.data?.queued ?? 0} resend row(s) queued.`;
            })}>Re-link</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={Boolean(confirm)} onClose={() => setConfirm(null)} fullWidth maxWidth="sm">
        <DialogTitle>{confirm?.title}</DialogTitle>
        <DialogContent><DialogContentText>{confirm?.text}</DialogContentText></DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirm(null)}>Cancel</Button>
          <Button variant="contained" color="warning" disabled={busy} onClick={() => confirm && act(confirm.run)}>Confirm</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default ChannexRepairPanel;
