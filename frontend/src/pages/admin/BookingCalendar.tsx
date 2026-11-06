/**
 * BookingCalendar – Gantt-style room booking view
 *
 * Design rationale (industry standard for hotel PMSs):
 *  • Rooms on the Y-axis (left sticky column) — one row per room
 *  • Dates on the X-axis (sticky header) — 8-day sliding window
 *  • Reservation bars span from check-in to check-out, color-coded by status
 *  • Room blocks (out of service) render as hatched bars on the room's lane
 *  • Unassigned lane at the bottom: every booked room still without a room of its own
 *    (whole reservations, or the missing rooms of partly assigned ones), stacked so
 *    overlapping stays stay readable; clicking one offers the free rooms to assign
 *  • Today column highlighted; nav arrows shift the window ±7 days
 *  • Click on a bar  → reservation quick-view modal (details + payments + check-in)
 *  • Click / drag on blank → new reservation, or block the room (with admin.rooms); the
 *    selected nights stay highlighted until that choice is made or its dialog closes
 *  • Drag a bar → move the stay to another room and/or dates (same nights); a live preview
 *    marks moves the loaded data already rules out, the server validates the move in full
 *  • Header shows each night's occupancy (rooms held / active rooms)
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Container,
  Divider,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  ListSubheader,
  Menu,
  MenuItem,
  Paper,
  Popover,
  Snackbar,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  ChevronLeft,
  ChevronRight,
  Today,
} from '@mui/icons-material';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import { DateCalendar } from '@mui/x-date-pickers/DateCalendar';
import AdminLayout from '../../components/admin/AdminLayout';
import CalendarReservationModal from '../../components/admin/reservations/CalendarReservationModal';
import CreateReservationDialog from '../../components/admin/reservations/CreateReservationDialog';
import RoomBlockDialog from '../../components/admin/roomBlocks/RoomBlockDialog';
import { roomsService, reservationsService, roomBlocksService } from '../../services/api';
import { Room, Reservation, RoomBlock } from '../../types';
import { useAuth } from '../../contexts/AuthContext';
import { useTranslation } from 'react-i18next';
import dayjs, { Dayjs } from 'dayjs';
import { getRoomIds, roomTypeIdOf, unassignedEntry, packLanes, UnassignedEntry, isoDay, occupancyByDay, moveConflict } from '../../utils/bookingCalendar';
import { channelText, otaShortTag } from '../../utils/channels';
import i18n from '../../i18n';

// ─── Layout constants ────────────────────────────────────────────────────────
const CELL_W = 130;   // px per day column
const ROW_H  = 52;    // px per room row (per lane)
const HEAD_H = 84;    // px for header row
const NAME_W = 185;   // px for room name column
const DAYS   = 8;     // number of days visible

// ─── Status colour map ───────────────────────────────────────────────────────
const STATUS_COLORS: Record<string, string> = {
  pending:      '#F59E0B',
  confirmed:    '#10B981',
  'checked-in': '#3B82F6',
  'checked-out':'#94A3B8',
  completed:    '#94A3B8',
};

const BLOCK_BG = 'repeating-linear-gradient(135deg, #CBD5E1 0px, #CBD5E1 6px, #E2E8F0 6px, #E2E8F0 12px)';

const UNASSIGNED = '__unassigned';
/** Statuses whose bars can be dragged to another room / dates */
const MOVABLE = ['pending', 'confirmed', 'checked-in'];

/** A reservation bar being dragged */
interface MoveDrag {
  res: Reservation;
  /** Room the bar was on (null = the Unassigned lane) */
  fromRoomId: string | null;
  fromLane: number;
  originX: number;
  originY: number;
  /** Past the drag threshold (until then a mouse-up is a click) */
  active: boolean;
  dayOffset: number;
  /** Row under the pointer (room id or UNASSIGNED); null = outside the grid, drop cancels */
  targetRowKey: string | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
const getGuestName = (res: Reservation, fallback: string) => {
  if (res.guestName?.firstName)
    return `${res.guestName.firstName} ${res.guestName.lastName ?? ''}`.trim();
  if (res.user && typeof res.user === 'object')
    return `${(res.user as any).firstName} ${(res.user as any).lastName}`;
  return fallback;
};

// ─── Component ───────────────────────────────────────────────────────────────
const BookingCalendar: React.FC = () => {
  const { t } = useTranslation();
  const { user, permissions } = useAuth();
  const isAdmin           = String(user?.role).toLowerCase() === 'admin';
  const canCheckIn        = isAdmin || (permissions || []).includes('admin.reservations.checkin');
  const canManagePayments = isAdmin || (permissions || []).includes('admin.reservations.managePayments');
  const canManageRooms    = isAdmin || (permissions || []).includes('admin.rooms');
  const canAssignRooms    = isAdmin || (permissions || []).includes('admin.reservations.assignRoom');
  const canEditDates      = isAdmin || (permissions || []).includes('admin.reservations');

  // ── Calendar state ─────────────────────────────────────────────────────────
  const [startDate, setStartDate]       = useState<Dayjs>(() => dayjs().startOf('day'));
  const [allRooms, setAllRooms]         = useState<Room[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [blocks, setBlocks]             = useState<RoomBlock[]>([]);
  const [loading, setLoading]           = useState(true);

  // ── View-reservation modal state ───────────────────────────────────────────
  const [viewRes, setViewRes] = useState<Reservation | null>(null);

  // ── Create-reservation dialog state ───────────────────────────────────────
  const [createOpen, setCreateOpen]           = useState(false);
  const [createDefaultCheckIn, setCreateDefaultCheckIn]   = useState('');
  const [createDefaultCheckOut, setCreateDefaultCheckOut] = useState('');
  const [createDefaultRoomId, setCreateDefaultRoomId]     = useState('');

  // ── Room block dialog + "new reservation / block room" menu ───────────────
  const [blockDialog, setBlockDialog] = useState<{ open: boolean; block: RoomBlock | null; defaults?: { roomId?: string; startDate?: string; endDate?: string } }>({ open: false, block: null });
  const [slotMenu, setSlotMenu] = useState<{ top: number; left: number; roomId: string; checkIn: string; checkOut: string } | null>(null);

  // ── Assign-room popover (Unassigned lane) ─────────────────────────────────
  const [assign, setAssign] = useState<{ anchorEl: HTMLElement; entry: UnassignedEntry; rooms: Room[]; loading: boolean; error: string | null } | null>(null);
  const [assigning, setAssigning] = useState(false);

  // ── Date-picker popover state ────────────────────────────────────────────
  const [pickerAnchor, setPickerAnchor] = useState<HTMLElement | null>(null);

  // ── Drag-selection state ───────────────────────────────────────────────────
  const [dragRoomId, setDragRoomId]       = useState<string | null>(null);
  const [dragStartIdx, setDragStartIdx]   = useState<number | null>(null);
  const [dragEndIdx, setDragEndIdx]       = useState<number | null>(null);
  const isDragging = useRef(false);
  /** Selected nights kept highlighted while choosing new reservation / block room and its dialog is open */
  const [heldSel, setHeldSel] = useState<{ rowKey: string; lo: number; hi: number } | null>(null);

  // ── Reservation drag and drop (move) state ────────────────────────────────
  const [moveDrag, setMoveDrag] = useState<MoveDrag | null>(null);
  const moveRef       = useRef<MoveDrag | null>(null);
  const suppressClick = useRef(false);
  const scrollRef     = useRef<HTMLDivElement | null>(null);
  // ── Shared snackbar ────────────────────────────────────────────────────────
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({ open: false, message: '', severity: 'success' });
  const showSnackbar = (message: string, severity: 'success' | 'error') => setSnackbar({ open: true, message, severity });

  const endDate = useMemo(() => startDate.add(DAYS - 1, 'day'), [startDate]);
  const days    = useMemo(
    () => Array.from({ length: DAYS }, (_, i) => startDate.add(i, 'day')),
    [startDate],
  );
  const today = dayjs().startOf('day');

  // ── Data fetching ──────────────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const from = startDate.format('YYYY-MM-DD');
      const to   = endDate.format('YYYY-MM-DD');
      const [roomsRes, resRes, blocksRes] = await Promise.all([
        roomsService.getRooms({ limit: 200 }),
        reservationsService.getReservations({ dateFrom: from, dateTo: to, type: 'room', limit: 500 }),
        roomBlocksService.list({ from, to }).catch(() => null),
      ]);
      setAllRooms(Array.isArray(roomsRes.data.data) ? roomsRes.data.data : (roomsRes.data.data as any)?.rooms ?? []);
      setReservations((resRes.data.data ?? []).filter((r: any) => r.status !== 'cancelled'));
      setBlocks(blocksRes?.data.data ?? []);
    } catch (e) {
      console.error('BookingCalendar: fetch failed', e);
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const rooms     = useMemo(() => allRooms.filter(r => r.status === 'active'), [allRooms]);
  const roomsById = useMemo(() => Object.fromEntries(allRooms.map(r => [r._id, r])) as Record<string, Room>, [allRooms]);
  const typeNames = useMemo(() => {
    const m: Record<string, string> = {};
    for (const r of allRooms) {
      const rt = r.roomTypeId as any;
      if (rt && typeof rt === 'object') m[String(rt._id)] = rt.name;
    }
    return m;
  }, [allRooms]);

  // ── Open create dialog pre-filled from a calendar click / drag ──────────
  const openCreateDialog = (checkIn: string, checkOut: string, roomId?: string) => {
    setCreateDefaultCheckIn(checkIn);
    setCreateDefaultCheckOut(checkOut);
    setCreateDefaultRoomId(roomId || '');
    setCreateOpen(true);
  };

  // ── Map reservations → rooms, blocks → rooms, unassigned entries ──────────
  const reservationsByRoom = useMemo(() => {
    const map: Record<string, Reservation[]> = {};
    for (const res of reservations) {
      if (res.type !== 'room') continue;
      for (const id of getRoomIds(res)) {
        if (!map[id]) map[id] = [];
        map[id].push(res);
      }
    }
    return map;
  }, [reservations]);

  const blocksByRoom = useMemo(() => {
    const map: Record<string, RoomBlock[]> = {};
    for (const b of blocks) {
      const id = typeof b.roomId === 'object' ? b.roomId._id : b.roomId;
      if (!map[id]) map[id] = [];
      map[id].push(b);
    }
    return map;
  }, [blocks]);

  /** Unassigned entries, each placed on the first lane where it doesn't overlap another */
  const unassignedLanes = useMemo(() => {
    const entries = reservations
      .filter(r => r.type === 'room')
      .map(r => unassignedEntry(r, roomsById))
      .filter((e): e is UnassignedEntry => e !== null);
    const { placed, lanes } = packLanes(entries, e => ({
      start: dayjs(e.res.checkInDate).startOf('day').valueOf(),
      end: (e.res.checkOutDate ? dayjs(e.res.checkOutDate) : dayjs(e.res.checkInDate).add(1, 'day')).startOf('day').valueOf(),
    }));
    return { placed: placed.map(({ item, lane }) => ({ entry: item, lane })), lanes };
  }, [reservations, roomsById]);

  /** Occupancy per visible night (as the occupancy reports count: rooms out of service are not available) */
  const occupancy = useMemo(
    () => occupancyByDay(days.map(d => d.format('YYYY-MM-DD')), reservations, roomsById, rooms.map(r => r._id), blocks),
    [days, reservations, roomsById, rooms, blocks],
  );

  // ── Drag and drop: where a dragged bar would land, and whether that is allowed ──
  const evaluateMove = (d: MoveDrag) => {
    const ci0 = dayjs(isoDay(d.res.checkInDate));
    const nights = Math.max(1, dayjs(isoDay(d.res.checkOutDate) || ci0.add(1, 'day').format('YYYY-MM-DD')).diff(ci0, 'day'));
    const ci = ci0.add(d.dayOffset, 'day');
    const checkIn = ci.format('YYYY-MM-DD');
    const checkOut = ci.add(nights, 'day').format('YYYY-MM-DD');
    const toRoomId = d.targetRowKey === UNASSIGNED ? null : d.targetRowKey;
    const dateChange = d.dayOffset !== 0;
    const roomChange = toRoomId !== d.fromRoomId;
    const currentIds = getRoomIds(d.res);
    const nextIds = roomChange && toRoomId
      ? (d.fromRoomId ? currentIds.map(id => (id === d.fromRoomId ? toRoomId : id)) : [...currentIds, toRoomId])
      : currentIds;

    let error: string | null = null;
    if (!toRoomId && d.fromRoomId) error = t('admin.bookingCalendar.moveToUnassigned');
    else if ((roomChange && !canAssignRooms) || (dateChange && !canEditDates)) error = t('admin.bookingCalendar.moveNoPermission');
    else if (dateChange && d.res.status === 'checked-in') error = t('admin.bookingCalendar.moveCheckedIn');
    else if (dateChange && ci.isBefore(today, 'day')) error = t('admin.bookingCalendar.movePast');
    else if (roomChange && toRoomId && currentIds.includes(toRoomId)) error = t('admin.bookingCalendar.moveAlreadyAssigned');
    else {
      for (const roomId of nextIds) {
        const c = moveConflict(d.res, roomId, checkIn, checkOut, reservationsByRoom[roomId] ?? [], blocksByRoom[roomId] ?? []);
        if (!c) continue;
        const room = roomsById[roomId]?.name ?? '';
        error = c.kind === 'block'
          ? t('admin.bookingCalendar.moveBlocked', { room })
          : t('admin.bookingCalendar.moveTaken', { room, guest: getGuestName(c.other, c.other.reservationCode ?? '') });
        break;
      }
    }
    return { checkIn, checkOut, toRoomId, nextIds, dateChange, roomChange, changed: dateChange || roomChange, error };
  };

  const dropMove = async (d: MoveDrag) => {
    if (!d.targetRowKey) return;
    const m = evaluateMove(d);
    if (!m.changed) return;
    if (m.error) { showSnackbar(m.error, 'error'); return; }

    // Optimistic: show the bar at its new place right away, put it back if the server refuses
    const primary = d.res.room ? (typeof d.res.room === 'object' ? (d.res.room as Room)._id : String(d.res.room)) : null;
    const moved: Reservation = {
      ...d.res,
      checkInDate:  `${m.checkIn}T12:00:00.000Z`,
      checkOutDate: `${m.checkOut}T12:00:00.000Z`,
      ...(m.roomChange ? { rooms: m.nextIds, room: !primary || primary === d.fromRoomId ? m.toRoomId! : primary } : {}),
    } as Reservation;
    setReservations(prev => prev.map(r => (r._id === d.res._id ? moved : r)));
    try {
      const res = await reservationsService.moveReservation(d.res._id, {
        ...(m.dateChange ? { checkInDate: m.checkIn } : {}),
        ...(m.roomChange ? { fromRoomId: d.fromRoomId, toRoomId: m.toRoomId } : {}),
      });
      const updated = res.data.data;
      if (updated) setReservations(prev => prev.map(r => (r._id === updated._id ? updated : r)));
      showSnackbar(t('admin.bookingCalendar.moved'), 'success');
    } catch (e: any) {
      setReservations(prev => prev.map(r => (r._id === d.res._id ? d.res : r)));
      showSnackbar(e?.response?.data?.message || t('admin.bookingCalendar.moveFailed'), 'error');
    }
  };
  const dropMoveRef = useRef(dropMove);
  dropMoveRef.current = dropMove;

  const startMove = (e: React.MouseEvent, res: Reservation, fromRoomId: string | null, fromLane: number) => {
    if (e.button !== 0) return;
    e.preventDefault(); // no text selection while dragging
    moveRef.current = { res, fromRoomId, fromLane, originX: e.clientX, originY: e.clientY, active: false, dayOffset: 0, targetRowKey: null };
  };

  // Pointer tracking for a dragged bar: snap to day columns / rows, drop on release, Esc cancels
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const d = moveRef.current;
      if (!d) return;
      const dx = e.clientX - d.originX;
      if (!d.active && Math.hypot(dx, e.clientY - d.originY) < 5) return;
      const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
      const next: MoveDrag = {
        ...d,
        active: true,
        dayOffset: Math.round(dx / CELL_W),
        targetRowKey: el?.closest('[data-row-key]')?.getAttribute('data-row-key') ?? null,
      };
      // Scroll the grid when dragging near its top / bottom edge
      const box = scrollRef.current?.getBoundingClientRect();
      if (box && scrollRef.current) {
        if (e.clientY < box.top + HEAD_H + 24) scrollRef.current.scrollTop -= 14;
        else if (e.clientY > box.bottom - 24) scrollRef.current.scrollTop += 14;
      }
      if (!d.active || next.dayOffset !== d.dayOffset || next.targetRowKey !== d.targetRowKey) {
        moveRef.current = next;
        setMoveDrag(next);
      }
    };
    const end = (drop: boolean) => {
      const d = moveRef.current;
      if (!d) return;
      moveRef.current = null;
      setMoveDrag(null);
      if (!d.active) return; // a plain click: the bar's onClick handles it
      suppressClick.current = true;
      setTimeout(() => { suppressClick.current = false; }, 0);
      if (drop) dropMoveRef.current(d);
    };
    const onUp = () => end(true);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') end(false); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  // ── Calculate bar position within the visible window ──────────────────────
  const calcSpan = (from: Dayjs, to: Dayjs): { left: number; width: number } | null => {
    const startOff   = from.diff(startDate, 'day');
    const endOff     = to.diff(startDate, 'day');
    const clamped0   = Math.max(0, startOff);
    const clampedEnd = Math.min(DAYS, endOff);
    if (clamped0 >= DAYS || clampedEnd <= 0) return null;
    return {
      left:  clamped0 * CELL_W + 4,
      width: (clampedEnd - clamped0) * CELL_W - 8,
    };
  };

  const calcBar = (res: Reservation) => {
    const ci = dayjs(res.checkInDate).startOf('day');
    const co = res.checkOutDate ? dayjs(res.checkOutDate).startOf('day') : ci.add(1, 'day');
    return calcSpan(ci, co);
  };

  // ── Reservation bar ────────────────────────────────────────────────────────
  const renderBar = (
    res: Reservation,
    opts: { key?: string; lane?: number; label?: string; hint?: string; onClick?: (el: HTMLElement) => void; fromRoomId?: string | null } = {},
  ) => {
    const bar = calcBar(res);
    if (!bar) return null;

    const fromRoomId = opts.fromRoomId ?? null;
    const draggable  = MOVABLE.includes(res.status) && (canEditDates || canAssignRooms);
    const dragging   = !!moveDrag?.active && moveDrag.res._id === res._id && moveDrag.fromRoomId === fromRoomId;

    const color     = STATUS_COLORS[res.status] ?? '#94A3B8';
    const guestName = getGuestName(res, t('admin.dashboard.recentReservations.guestFallback'));
    const dates     = `${res.checkInDate ? new Date(res.checkInDate).toLocaleDateString(i18n.language) : ''} → ${res.checkOutDate ? new Date(res.checkOutDate).toLocaleDateString(i18n.language) : '–'}`;

    return (
      <Tooltip
        key={opts.key ?? res._id}
        title={[opts.label ?? guestName, res.channelSource ? channelText(res.channelSource) : undefined, dates, opts.hint, draggable ? t('admin.bookingCalendar.dragToMove') : undefined].filter(Boolean).join(' · ')}
        arrow
        placement="top"
        enterDelay={300}
        disableHoverListener={!!moveDrag?.active}
      >
        <Box
          onMouseDown={(e) => {
            e.stopPropagation();
            if (draggable) startMove(e, res, fromRoomId, opts.lane ?? 0);
          }}
          onClick={(e) => {
            e.stopPropagation();
            if (suppressClick.current) return;
            if (opts.onClick) opts.onClick(e.currentTarget as HTMLElement);
            else setViewRes(res);
          }}
          sx={{
            position:   'absolute',
            top:        (opts.lane ?? 0) * ROW_H + 8,
            height:     ROW_H - 16,
            left:       bar.left,
            width:      bar.width,
            bgcolor:    color,
            borderRadius: 1,
            display:    'flex',
            alignItems: 'center',
            px:         1,
            cursor:     moveDrag?.active ? 'grabbing' : draggable ? 'grab' : 'pointer',
            overflow:   'hidden',
            zIndex:     1,
            opacity:    dragging ? 0.35 : 1,
            boxShadow:  '0 1px 3px rgba(0,0,0,0.25)',
            transition: 'filter 0.15s, opacity 0.15s',
            '&:hover': { filter: 'brightness(0.88)', zIndex: 2 },
          }}
        >
          {res.channelSource && (
            <Box component="span" sx={{ flexShrink: 0, mr: 0.5, px: 0.5, border: '1px solid rgba(255,255,255,0.8)', borderRadius: 0.5, color: '#fff', fontSize: 10, fontWeight: 700, lineHeight: 1.4 }}>
              {otaShortTag(res.channelSource)}
            </Box>
          )}
          <Typography variant="caption" color="#fff" noWrap fontWeight={600} sx={{ lineHeight: 1.2 }}>
            {opts.label ?? guestName}
          </Typography>
        </Box>
      </Tooltip>
    );
  };

  // ── Drop preview: where the dragged bar lands on this row ─────────────────
  const renderMovePreview = (rowKey: string) => {
    if (!moveDrag?.active || moveDrag.targetRowKey !== rowKey) return null;
    const m = evaluateMove(moveDrag);
    const span = calcSpan(dayjs(m.checkIn), dayjs(m.checkOut));
    if (!span) return null;
    const lane = rowKey === UNASSIGNED && moveDrag.fromRoomId === null ? moveDrag.fromLane : 0;
    const guestName = getGuestName(moveDrag.res, t('admin.dashboard.recentReservations.guestFallback'));
    const label = m.error ?? `${guestName} · ${dayjs(m.checkIn).format('D MMM')} → ${dayjs(m.checkOut).format('D MMM')}`;
    return (
      <Box
        key="move-preview"
        sx={{
          position: 'absolute', top: lane * ROW_H + 6, height: ROW_H - 12, left: span.left - 2, width: span.width + 4,
          bgcolor: m.error ? '#EF4444' : (STATUS_COLORS[moveDrag.res.status] ?? '#94A3B8'),
          border: '2px dashed rgba(255,255,255,0.95)', borderRadius: 1,
          display: 'flex', alignItems: 'center', px: 1, overflow: 'hidden', zIndex: 3,
          boxShadow: '0 6px 16px rgba(15,23,42,0.28)', pointerEvents: 'none',
          transition: 'left 90ms ease-out, width 90ms ease-out',
        }}
      >
        <Typography variant="caption" color="#fff" noWrap fontWeight={700} sx={{ lineHeight: 1.2 }}>{label}</Typography>
      </Box>
    );
  };

  // ── Room block bar (hatched) ──────────────────────────────────────────────
  const renderBlock = (block: RoomBlock) => {
    const span = calcSpan(dayjs(block.startDate), dayjs(block.endDate));
    if (!span) return null;
    const label = `${t('admin.bookingCalendar.outOfService')} · ${t(`admin.roomBlocks.reasons.${block.reason}`)}`;
    return (
      <Tooltip
        key={`block-${block._id}`}
        title={[label, `${dayjs(block.startDate).format('D MMM')} → ${dayjs(block.endDate).format('D MMM')}`, block.notes].filter(Boolean).join(' · ')}
        arrow
        placement="top"
        enterDelay={300}
      >
        <Box
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); setBlockDialog({ open: true, block }); }}
          sx={{
            position: 'absolute', top: 8, height: ROW_H - 16, left: span.left, width: span.width,
            background: BLOCK_BG, border: '1px dashed #64748B', borderRadius: 1,
            display: 'flex', alignItems: 'center', px: 1, cursor: 'pointer', overflow: 'hidden', zIndex: 1,
            '&:hover': { filter: 'brightness(0.93)', zIndex: 2 },
          }}
        >
          <Typography variant="caption" noWrap fontWeight={600} sx={{ color: '#334155', lineHeight: 1.2 }}>{label}</Typography>
        </Box>
      </Tooltip>
    );
  };

  // ── Assign a room to an unassigned booked room ────────────────────────────
  const openAssign = async (anchorEl: HTMLElement, entry: UnassignedEntry) => {
    if (!canAssignRooms) { setViewRes(entry.res); return; }
    setAssign({ anchorEl, entry, rooms: [], loading: true, error: null });
    const ci = isoDay(entry.res.checkInDate);
    const co = entry.res.checkOutDate ? isoDay(entry.res.checkOutDate) : dayjs(ci).add(1, 'day').format('YYYY-MM-DD');
    try {
      const res = await roomsService.getAvailableRooms(ci, co, { excludeReservationId: entry.res._id });
      const taken = new Set(getRoomIds(entry.res));
      const free = (res.data.data ?? []).filter(r => !taken.has(r._id));
      setAssign(a => (a && a.entry.res._id === entry.res._id ? { ...a, rooms: free, loading: false } : a));
    } catch (e: any) {
      setAssign(a => (a ? { ...a, loading: false, error: e?.response?.data?.message || t('admin.bookingCalendar.assignFailed') } : a));
    }
  };

  const assignRoom = async (room: Room) => {
    if (!assign) return;
    setAssigning(true);
    try {
      await reservationsService.assignRooms(assign.entry.res._id, [...getRoomIds(assign.entry.res), room._id]);
      showSnackbar(t('admin.bookingCalendar.roomAssigned', { room: room.name }), 'success');
      setAssign(null);
      fetchData();
    } catch (e: any) {
      setAssign(a => (a ? { ...a, error: e?.response?.data?.message || t('admin.bookingCalendar.assignFailed') } : a));
    } finally {
      setAssigning(false);
    }
  };

  // ── Shared day-grid lines inside a row ────────────────────────────────────
  const renderGridLines = (height: number) =>
    days.map((day, i) => (
      <div
        key={i}
        style={{
          position:    'absolute',
          left:        i * CELL_W,
          top:         0,
          width:       CELL_W,
          height,
          borderRight: '1px solid rgba(0,0,0,0.07)',
          background:  day.isSame(today, 'day') ? 'rgba(59,130,246,0.06)' : 'transparent',
          boxSizing:   'border-box',
        }}
      />
    ));

  // ── Row renderer ──────────────────────────────────────────────────────────
  const renderRow = (
    key: string,
    name: React.ReactNode,
    bars: React.ReactNode,
    isUnassigned: boolean,
    stripeIdx: number,
    lanes = 1,
  ) => {
    const bg = isUnassigned ? '#FFFBEB' : stripeIdx % 2 === 0 ? '#ffffff' : '#F8FAFC';
    const height = ROW_H * lanes;

    const getDayIdx = (e: React.MouseEvent<HTMLTableCellElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      return Math.min(Math.floor((e.clientX - rect.left) / CELL_W), DAYS - 1);
    };

    const handleMouseDown = (e: React.MouseEvent<HTMLTableCellElement>) => {
      // Only respond to left-click
      if (e.button !== 0) return;
      const dayIdx = getDayIdx(e);
      setHeldSel(null);
      setDragRoomId(key);
      setDragStartIdx(dayIdx);
      setDragEndIdx(dayIdx);
      isDragging.current = true;
      e.preventDefault(); // prevent text selection
    };

    const handleMouseMove = (e: React.MouseEvent<HTMLTableCellElement>) => {
      if (!isDragging.current || dragRoomId !== key) return;
      setDragEndIdx(getDayIdx(e));
    };

    const handleMouseUp = (e: React.MouseEvent<HTMLTableCellElement>) => {
      if (!isDragging.current || dragRoomId !== key || dragStartIdx === null) {
        isDragging.current = false;
        return;
      }
      isDragging.current = false;
      const endIdx = getDayIdx(e);
      const lo = Math.min(dragStartIdx, endIdx);
      const hi = Math.max(dragStartIdx, endIdx);
      const checkIn  = days[lo].format('YYYY-MM-DD');
      // Single click: check-out is next day (1 night). Multi-cell drag: last cell IS the check-out date.
      const checkOut = lo === hi
        ? days[hi].add(1, 'day').format('YYYY-MM-DD')
        : days[hi].format('YYYY-MM-DD');
      setDragRoomId(null);
      setDragStartIdx(null);
      setDragEndIdx(null);
      // Keep the nights highlighted until the menu choice is made / its dialog closes
      setHeldSel({ rowKey: key, lo, hi });
      if (!isUnassigned && canManageRooms) {
        // Choose between a reservation and taking the room out of service
        setSlotMenu({ top: e.clientY, left: e.clientX, roomId: key, checkIn, checkOut });
      } else {
        openCreateDialog(checkIn, checkOut, isUnassigned ? undefined : key);
      }
    };

    // Compute selection highlight for this row (live drag, or the held selection)
    const selecting = dragRoomId === key && dragStartIdx !== null && dragEndIdx !== null;
    const held = !selecting && heldSel?.rowKey === key ? heldSel : null;
    const selLo = selecting ? Math.min(dragStartIdx!, dragEndIdx!) : held ? held.lo : null;
    const selHi = selecting ? Math.max(dragStartIdx!, dragEndIdx!) : held ? held.hi : null;

    return (
      <tr key={key} data-row-key={key} style={{ height }}>
        {/* Sticky room-name cell */}
        <td
          style={{
            position:      'sticky',
            left:          0,
            zIndex:        1,
            width:         NAME_W,
            minWidth:      NAME_W,
            maxWidth:      NAME_W,
            borderRight:   '1px solid rgba(0,0,0,0.1)',
            borderBottom:  '1px solid rgba(0,0,0,0.07)',
            padding:       '0 14px',
            background:    bg,
            verticalAlign: 'middle',
          }}
        >
          {name}
        </td>

        {/* Relative container holding grid lines + bars + drag highlight */}
        <td
          colSpan={DAYS}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          style={{
            position:      'relative',
            width:         CELL_W * DAYS,
            minWidth:      CELL_W * DAYS,
            height,
            padding:       0,
            borderBottom:  '1px solid rgba(0,0,0,0.07)',
            background:    bg,
            verticalAlign: 'top',
            overflow:      'hidden',
            cursor:        moveDrag?.active ? 'grabbing' : 'cell',
            userSelect:    'none',
          }}
        >
          {renderGridLines(height)}

          {/* Drag-selection highlight overlay */}
          {selLo !== null && selHi !== null && (
            <div
              style={{
                position:     'absolute',
                top:          2,
                height:       height - 4,
                left:         selLo * CELL_W + 2,
                width:        (selHi - selLo + 1) * CELL_W - 4,
                background:   'rgba(59,130,246,0.18)',
                border:       '2px solid rgba(59,130,246,0.5)',
                borderRadius: 4,
                zIndex:       0,
                pointerEvents: 'none',
              }}
            />
          )}

          {bars}
          {renderMovePreview(key)}
        </td>
      </tr>
    );
  };

  // Clear drag state if mouse released outside the grid
  useEffect(() => {
    const handleGlobalMouseUp = () => {
      if (isDragging.current) {
        isDragging.current = false;
        setDragRoomId(null);
        setDragStartIdx(null);
        setDragEndIdx(null);
      }
    };
    window.addEventListener('mouseup', handleGlobalMouseUp);
    return () => window.removeEventListener('mouseup', handleGlobalMouseUp);
  }, []);

  const hasUnassigned = unassignedLanes.placed.length > 0;
  const unassignedRoomCount = unassignedLanes.placed.reduce((n, p) => n + p.entry.missing, 0);

  const roomNameCell = (room: Room) => {
    const typeId = roomTypeIdOf(room);
    return (
      <Box sx={{ overflow: 'hidden' }}>
        <Typography variant="body2" fontWeight={600} noWrap color="text.primary">{room.name}</Typography>
        {typeId && typeNames[typeId] && (
          <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block', lineHeight: 1.1 }}>{typeNames[typeId]}</Typography>
        )}
      </Box>
    );
  };

  const unassignedLabel = (entry: UnassignedEntry) => {
    const guest = getGuestName(entry.res, t('admin.dashboard.recentReservations.guestFallback'));
    const types = [...new Set(entry.typeIds.map(id => (id ? typeNames[id] : null)).filter(Boolean))].join(', ');
    const count = entry.missing > 1 ? ` ×${entry.missing}` : '';
    return [guest, types].filter(Boolean).join(' · ') + count;
  };

  // Assign popover: rooms of the booked type(s) first, then other rooms (upgrades)
  const assignGroups = useMemo(() => {
    if (!assign) return { matching: [] as Room[], others: [] as Room[] };
    const booked = new Set(assign.entry.typeIds.filter(Boolean) as string[]);
    const matching = assign.rooms.filter(r => booked.has(roomTypeIdOf(r) ?? ''));
    const others = assign.rooms.filter(r => !booked.has(roomTypeIdOf(r) ?? ''));
    return { matching, others };
  }, [assign]);

  const roomOption = (room: Room) => {
    const rt = room.roomTypeId as any;
    const secondary = rt && typeof rt === 'object' ? `${rt.name} · ${t('admin.bookingCalendar.capacity', { count: rt.capacity })}` : undefined;
    return (
      <ListItemButton key={room._id} dense disabled={assigning} onClick={() => assignRoom(room)}>
        <ListItemText primary={room.name} secondary={secondary} />
      </ListItemButton>
    );
  };

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <AdminLayout title={t('admin.bookingCalendar.title')}>
      <Container maxWidth={false} sx={{ pt: 0, pb: 4, px: { xs: 2, md: 3 } }}>

        {/* ── Legend + Date nav on same row ── */}
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', mb: 2.5, gap: 2 }}>
          {/* Status legend */}
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
            {Object.entries(STATUS_COLORS).map(([status, color]) => (
              <Box key={status} sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                <Box sx={{ width: 12, height: 12, borderRadius: 0.5, bgcolor: color, flexShrink: 0 }} />
                <Typography variant="caption" color="text.secondary">
                  {t(`admin.reservations.statusLabels.${status.replace('-', '_')}`, status)}
                </Typography>
              </Box>
            ))}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
              <Box sx={{ width: 12, height: 12, borderRadius: 0.5, background: BLOCK_BG, border: '1px dashed #64748B', flexShrink: 0 }} />
              <Typography variant="caption" color="text.secondary">{t('admin.bookingCalendar.outOfService')}</Typography>
            </Box>
          </Box>
          {/* Date navigation */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Button
              size="small"
              variant="outlined"
              startIcon={<Today />}
              onClick={() => setStartDate(dayjs().startOf('day'))}
              disabled={startDate.isSame(today, 'day')}
            >
              {t('admin.bookingCalendar.today')}
            </Button>
            <IconButton size="small" onClick={() => setStartDate(d => d.subtract(7, 'day'))}>
              <ChevronLeft />
            </IconButton>
            <Button
              size="small"
              variant="text"
              onClick={(e) => setPickerAnchor(e.currentTarget)}
              sx={{ minWidth: 190, fontWeight: 500, fontSize: '0.875rem', textTransform: 'none', color: 'text.primary' }}
            >
              {startDate.format('MMM D')} – {endDate.format('MMM D, YYYY')}
            </Button>
            <Popover
              open={Boolean(pickerAnchor)}
              anchorEl={pickerAnchor}
              onClose={() => setPickerAnchor(null)}
              anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
              transformOrigin={{ vertical: 'top', horizontal: 'center' }}
              PaperProps={{ sx: { borderRadius: 2, boxShadow: 3, mt: 0.5 } }}
            >
              <LocalizationProvider dateAdapter={AdapterDayjs}>
                <DateCalendar
                  value={startDate}
                  onChange={(newDate: Dayjs | null) => {
                    if (newDate) {
                      setStartDate(newDate.startOf('day'));
                      setPickerAnchor(null);
                    }
                  }}
                />
              </LocalizationProvider>
            </Popover>
            <IconButton size="small" onClick={() => setStartDate(d => d.add(7, 'day'))}>
              <ChevronRight />
            </IconButton>
          </Box>
        </Box>

        {/* ── Calendar grid ── */}
        {loading ? (
          <Box sx={{ py: 12, textAlign: 'center' }}>
            <CircularProgress />
          </Box>
        ) : (
          <Paper
            variant="outlined"
            sx={{
              overflow: 'hidden',
              borderRadius: 2,
              border: '1px solid',
              borderColor: 'divider',
            }}
          >
            <Box
              ref={scrollRef}
              sx={{
                overflowX: 'auto',
                overflowY: 'auto',
                maxHeight: 'calc(100vh - 290px)',
              }}
            >
              <table
                style={{
                  borderCollapse: 'collapse',
                  tableLayout:    'fixed',
                  width:          NAME_W + CELL_W * DAYS,
                  minWidth:       NAME_W + CELL_W * DAYS,
                }}
              >
                {/* ── Sticky date header ── */}
                <thead>
                  <tr style={{ height: HEAD_H }}>
                    {/* Corner cell */}
                    <th
                      style={{
                        position:    'sticky',
                        top:         0,
                        left:        0,
                        zIndex:      4,
                        width:       NAME_W,
                        minWidth:    NAME_W,
                        maxWidth:    NAME_W,
                        background:  '#F1F5F9',
                        borderRight: '1px solid rgba(0,0,0,0.12)',
                        borderBottom:'2px solid rgba(0,0,0,0.12)',
                        padding:     '0 14px',
                        textAlign:   'left',
                      }}
                    >
                      <Typography
                        variant="caption"
                        fontWeight={700}
                        color="text.secondary"
                        sx={{ textTransform: 'uppercase', letterSpacing: 0.8 }}
                      >
                        {t('admin.bookingCalendar.room')}
                      </Typography>
                    </th>

                    {/* Day columns */}
                    {days.map((day, i) => {
                      const isToday = day.isSame(today, 'day');
                      const occ = occupancy[i];
                      return (
                        <th
                          key={day.toISOString()}
                          style={{
                            position:    'sticky',
                            top:         0,
                            zIndex:      3,
                            width:       CELL_W,
                            minWidth:    CELL_W,
                            maxWidth:    CELL_W,
                            background:  isToday ? '#EFF6FF' : '#F1F5F9',
                            borderRight: '1px solid rgba(0,0,0,0.08)',
                            borderBottom: isToday
                              ? '2px solid #3B82F6'
                              : '2px solid rgba(0,0,0,0.12)',
                            padding:     '6px 0',
                            textAlign:   'center',
                          }}
                        >
                          <Typography
                            variant="caption"
                            sx={{ display: 'block', letterSpacing: 0.5 }}
                            color={isToday ? 'primary.main' : 'text.secondary'}
                            fontWeight={isToday ? 700 : 500}
                          >
                            {day.format('ddd').toUpperCase()}
                          </Typography>
                          <Typography
                            variant="body2"
                            fontWeight={isToday ? 700 : 400}
                            color={isToday ? 'primary.main' : 'text.primary'}
                          >
                            {day.format('D')}
                          </Typography>
                          <Typography
                            variant="caption"
                            color="text.disabled"
                            sx={{ display: 'block', fontSize: '0.65rem' }}
                          >
                            {day.format('MMM')}
                          </Typography>
                          <Tooltip title={t('admin.bookingCalendar.occupancyTooltip', { sold: occ.sold, total: occ.available, pct: occ.pct })} arrow>
                            <Box sx={{ width: 72, mx: 'auto', mt: 0.5 }}>
                              <Box sx={{ height: 4, borderRadius: 2, bgcolor: 'rgba(0,0,0,0.08)', overflow: 'hidden' }}>
                                <Box sx={{ height: '100%', width: `${Math.min(100, occ.pct)}%`, bgcolor: occ.pct > 100 ? 'error.main' : 'primary.main', transition: 'width 0.3s' }} />
                              </Box>
                              <Typography variant="caption" sx={{ display: 'block', fontSize: '0.68rem', fontWeight: 600, lineHeight: 1.5 }} color={occ.pct > 100 ? 'error.main' : 'text.secondary'}>
                                {t('admin.bookingCalendar.occupancy', { pct: occ.pct })}
                              </Typography>
                            </Box>
                          </Tooltip>
                        </th>
                      );
                    })}
                  </tr>
                </thead>

                {/* ── Room rows ── */}
                <tbody>
                  {rooms.map((room, idx) =>
                    renderRow(
                      room._id,
                      roomNameCell(room),
                      <>
                        {(blocksByRoom[room._id] ?? []).map(b => renderBlock(b))}
                        {(reservationsByRoom[room._id] ?? []).map(res => renderBar(res, { fromRoomId: room._id }))}
                      </>,
                      false,
                      idx,
                    )
                  )}

                  {/* Unassigned lane: booked rooms still waiting for a room */}
                  {hasUnassigned && renderRow(
                    UNASSIGNED,
                    <Box>
                      <Typography variant="body2" fontWeight={600} noWrap color="warning.dark">{t('admin.bookingCalendar.unassigned')}</Typography>
                      <Typography variant="caption" color="warning.dark" sx={{ display: 'block', lineHeight: 1.1 }}>
                        {t('admin.bookingCalendar.unassignedCount', { count: unassignedRoomCount })}
                      </Typography>
                    </Box>,
                    unassignedLanes.placed.map(({ entry, lane }) => renderBar(entry.res, {
                      key: `un-${entry.res._id}`,
                      lane,
                      label: unassignedLabel(entry),
                      hint: canAssignRooms ? t('admin.bookingCalendar.clickToAssign') : undefined,
                      onClick: (el) => openAssign(el, entry),
                    })),
                    true,
                    rooms.length,
                    unassignedLanes.lanes,
                  )}

                  {/* Empty state */}
                  {rooms.length === 0 && (
                    <tr>
                      <td
                        colSpan={DAYS + 1}
                        style={{ padding: 48, textAlign: 'center' }}
                      >
                        <Typography color="text.secondary">
                          {t('admin.bookingCalendar.noRooms')}
                        </Typography>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </Box>
          </Paper>
        )}
      </Container>

      {/* ── New reservation / block room menu (after selecting cells on a room) ── */}
      <Menu
        open={Boolean(slotMenu)}
        onClose={() => { setSlotMenu(null); setHeldSel(null); }}
        anchorReference="anchorPosition"
        anchorPosition={slotMenu ? { top: slotMenu.top, left: slotMenu.left } : undefined}
      >
        <MenuItem onClick={() => { if (slotMenu) openCreateDialog(slotMenu.checkIn, slotMenu.checkOut, slotMenu.roomId); setSlotMenu(null); }}>
          {t('admin.bookingCalendar.newReservation')}
        </MenuItem>
        <MenuItem onClick={() => {
          if (slotMenu) setBlockDialog({ open: true, block: null, defaults: { roomId: slotMenu.roomId, startDate: slotMenu.checkIn, endDate: slotMenu.checkOut } });
          setSlotMenu(null);
        }}>
          {t('admin.bookingCalendar.blockRoom')}
        </MenuItem>
      </Menu>

      {/* ── Assign a room (Unassigned lane) ── */}
      <Popover
        open={Boolean(assign)}
        anchorEl={assign?.anchorEl}
        onClose={() => setAssign(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        PaperProps={{ sx: { width: 300, maxHeight: 420, borderRadius: 2 } }}
      >
        {assign && (
          <Box>
            <Box sx={{ px: 2, pt: 1.5, pb: 1 }}>
              <Typography variant="subtitle2">{t('admin.bookingCalendar.assignRoom')}</Typography>
              <Typography variant="caption" color="text.secondary">{unassignedLabel(assign.entry)}</Typography>
            </Box>
            <Divider />
            {assign.loading ? (
              <Box sx={{ py: 3, textAlign: 'center' }}><CircularProgress size={24} /></Box>
            ) : (
              <>
                {assign.error && <Alert severity="error" sx={{ m: 1.5 }}>{assign.error}</Alert>}
                {assign.rooms.length === 0 && !assign.error && (
                  <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>{t('admin.bookingCalendar.noFreeRooms')}</Typography>
                )}
                <List dense disablePadding>
                  {assignGroups.matching.length > 0 && (
                    <ListSubheader disableSticky>{t('admin.bookingCalendar.bookedType')}</ListSubheader>
                  )}
                  {assignGroups.matching.map(roomOption)}
                  {assignGroups.others.length > 0 && (
                    <ListSubheader disableSticky>{t('admin.bookingCalendar.otherRooms')}</ListSubheader>
                  )}
                  {assignGroups.others.map(roomOption)}
                </List>
              </>
            )}
            <Divider />
            <Box sx={{ display: 'flex', justifyContent: 'flex-end', p: 1 }}>
              <Button size="small" onClick={() => { setViewRes(assign.entry.res); setAssign(null); }}>
                {t('admin.bookingCalendar.viewDetails')}
              </Button>
            </Box>
          </Box>
        )}
      </Popover>

      {/* ══════════════════════════════════════════════════════════════
          RESERVATION QUICK-VIEW MODAL
      ══════════════════════════════════════════════════════════════ */}
      <CalendarReservationModal
        reservation={viewRes}
        onClose={() => setViewRes(null)}
        onUpdated={(updated) => {
          setViewRes(updated);
          setReservations(prev => prev.map(r => r._id === updated._id ? updated : r));
        }}
        canCheckIn={canCheckIn}
        canManagePayments={canManagePayments}
        onSnackbar={showSnackbar}
      />

      {/* ══════════════════════════════════════════════════════════════
          CREATE RESERVATION DIALOG (unified)
      ══════════════════════════════════════════════════════════════ */}
      <CreateReservationDialog
        open={createOpen}
        defaultType="room"
        defaultCheckIn={createDefaultCheckIn}
        defaultCheckOut={createDefaultCheckOut}
        defaultRoomId={createDefaultRoomId}
        onClose={() => { setCreateOpen(false); setHeldSel(null); }}
        onCreated={fetchData}
        onSnackbar={showSnackbar}
        reservationServices={{ accommodation: true, daypass: false, pasatarde: false, event: false }}
      />

      {/* ── Room block (out of service) ── */}
      <RoomBlockDialog
        open={blockDialog.open}
        rooms={rooms}
        block={blockDialog.block}
        defaults={blockDialog.defaults}
        canManage={canManageRooms}
        onClose={() => { setBlockDialog({ open: false, block: null }); setHeldSel(null); }}
        onSaved={(message) => { showSnackbar(message, 'success'); fetchData(); }}
      />

      {/* ── Snackbar ── */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={4000}
        onClose={() => setSnackbar(s => ({ ...s, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity={snackbar.severity} onClose={() => setSnackbar(s => ({ ...s, open: false }))}>
          {snackbar.message}
        </Alert>
      </Snackbar>

    </AdminLayout>
  );
};

export default BookingCalendar;
