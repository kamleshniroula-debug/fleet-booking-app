// Prince Vehicle Rental - read-only, partner-scoped fleet availability.
// Source of truth: the latest administrator Supabase backup written AFTER OneDrive succeeds.
// Never return customer identities, rates, booking notes, owner or staff records.
import { createClient } from 'npm:@supabase/supabase-js@2';

const PROJECT_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ALLOWED_ORIGIN = 'https://kamleshniroula-debug.github.io';
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_EVENTS = 10000;
const admin = createClient(PROJECT_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const cors = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Vary': 'Origin',
  'Cache-Control': 'no-store',
};
const respond = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status, headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' },
  });
const str = (x: unknown) => typeof x === 'string' ? x.trim() : String(x ?? '').trim();
const norm = (x: unknown) => str(x).toLowerCase();
const validDate = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) &&
  Number.isFinite(Date.parse(d + 'T00:00:00Z')) &&
  new Date(d + 'T00:00:00Z').toISOString().slice(0, 10) === d;
const excludedStatuses = new Set(['cancelled', 'canceled', 'returned', 'completed', 'deleted', 'rejected']);
const retiredNames = new Set(['sonet', 'kia sonet', 'toyota', 'tata punch', 's05 white', 'white s05', 'deepal s05', 's05']);

type FleetRow = Record<string, unknown>;
type Event = { vehicle_id: string; start_ad: string; end_ad_exclusive: string; kind: 'booked' | 'maintenance' };
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return respond({ error: 'Method not allowed' }, 405);
  try {
    const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
    if (!token) return respond({ error: 'Google sign-in required' }, 401);
    const { data: { user }, error: authError } = await admin.auth.getUser(token);
    if (authError || !user) return respond({ error: 'Invalid login' }, 401);
    const { data: membership, error: mError } = await admin.from('pvr_partner_members')
      .select('company_id,active').eq('user_id', user.id).eq('active', true).maybeSingle();
    if (mError) throw mError;
    if (!membership) return respond({ error: 'Active rental company assignment required' }, 403);
    const { data: company, error: cError } = await admin.from('pvr_rental_companies')
      .select('company_id,active').eq('company_id', membership.company_id).eq('active', true).maybeSingle();
    if (cError) throw cError;
    if (!company) return respond({ error: 'Rental company is inactive' }, 403);

    // Only snapshots of active PVR administrators qualify as a fleet source.
    const { data: administrators, error: adminsError } = await admin.from('pvr_members')
      .select('user_id').eq('role', 'admin').eq('active', true).limit(100);
    if (adminsError) throw adminsError;
    const ids = (administrators || []).map((r) => str(r.user_id)).filter(Boolean);
    if (!ids.length) return respond({ verified: false, snapshot_at: null,
      reason: 'No active administrator snapshot is available.', vehicles: [], periods: [], uncertain_vehicle_ids: [] });
    const { data: backups, error: bError } = await admin.from('pvr_workbook_snapshots')
      .select('user_id,payload').in('user_id', ids).limit(100);
    if (bError) throw bError;
    const backupsSorted = (backups || []).filter((r) => {
      const p = r.payload as Record<string, unknown> | null;
      return p?.schema_version === 1 && p?.sheets && typeof p.saved_at === 'string';
    }).sort((a, b) => Date.parse(str((b.payload as FleetRow).saved_at)) - Date.parse(str((a.payload as FleetRow).saved_at)));
    const snapshot = backupsSorted[0]?.payload as FleetRow | undefined;
    const sheets = snapshot?.sheets as Record<string, unknown> | undefined;
    if (!sheets || !Array.isArray(sheets['Vehicles']) || !Array.isArray(sheets['Bookings'])) {
      return respond({ verified: false, snapshot_at: null,
        reason: 'No complete fleet backup has been saved after OneDrive synchronization.',
        vehicles: [], periods: [], uncertain_vehicle_ids: [] });
    }
    const snapshotAt = str(snapshot?.saved_at);
    const age = Date.now() - Date.parse(snapshotAt);
    const fresh = Number.isFinite(age) && age >= -300000 && age <= MAX_AGE_MS;
    const vehicles = (sheets['Vehicles'] as FleetRow[]).filter(v => {
      const name = norm(v['Vehicle Name']).replace(/\s+/g, ' ');
      return norm(v['Status']) === 'active' && !!str(v['Vehicle ID']) && !retiredNames.has(name);
    }).map(v => ({
      vehicle_id: str(v['Vehicle ID']), vehicle_name: str(v['Vehicle Name']) || 'Vehicle',
      registration: str(v['Registration']), colour: str(v['Colour']),
      model: str(v['Model']), seats: str(v['Seats']),
      manufacture_year: str(v['Manufacture Year']), type: str(v['Vehicle Type']),
    }));
    const allowedIds = new Set(vehicles.map(v => v.vehicle_id));
    const uncertain = new Set<string>();
    let allVehiclesUncertain = false;
    const periods: Event[] = [];
    const appendPeriod = (row: FleetRow, kind: Event['kind']) => {
      if (excludedStatuses.has(norm(row['Status']))) return;
      const id = str(row['Vehicle ID']);
      if (!id) { allVehiclesUncertain = true; return; }
      if (!allowedIds.has(id)) return;
      const start = str(row['Start AD']);
      let end = str(row['End AD Exclusive']);
      if (kind === 'maintenance' && validDate(start) && !end) end = '2099-12-31';
      if (!validDate(start) || !validDate(end) || start >= end) { uncertain.add(id); return; }
      if (periods.length >= MAX_EVENTS) { allVehiclesUncertain = true; return; }
      periods.push({ vehicle_id: id, start_ad: start, end_ad_exclusive: end, kind });
    };
    for (const b of sheets['Bookings'] as FleetRow[]) appendPeriod(b, 'booked');
    for (const m of Array.isArray(sheets['Maintenance']) ? sheets['Maintenance'] as FleetRow[] : []) appendPeriod(m, 'maintenance');
    periods.sort((a, b) => a.start_ad.localeCompare(b.start_ad));
    return respond({ verified: fresh && !allVehiclesUncertain, snapshot_at: snapshotAt,
      reason: fresh ? (allVehiclesUncertain ? 'Some fleet booking rows have no vehicle or verified dates.' : '')
        : 'The last saved fleet snapshot is older than 24 hours. Ask Prince Vehicle Rental to sync OneDrive and save a new Supabase backup.',
      vehicles, periods: fresh ? periods : [], uncertain_vehicle_ids: [...uncertain],
      all_vehicles_uncertain: allVehiclesUncertain, source: 'OneDrive-saved Supabase backup',
      note: 'Availability is provisional. Requests are pending until reviewed by Prince Vehicle Rental.' });
  } catch (error) {
    console.error('partner-availability', error);
    return respond({ error: 'Availability could not be loaded. Ask Prince Vehicle Rental to check Edge Function logs.' }, 500);
  }
});
