import { useEffect, useState } from 'react';
import { LoadingBlock } from '../../components/Loading';
import { ApiRequestError, apiFetch } from '../../lib/api';
import { unitTypeLabel } from '../auth/access-labels';
import { useAuth } from '../auth/AuthContext';
import { Icon, type IconName } from '../../components/Icon';
import { RenameUnitDialog } from './RenameUnitDialog';

interface Unit {
  id: string;
  code: string;
  name: string;
  type: string;
  parentId?: string | null;
  organization: { name: string };
}
interface Employee {
  id: string;
  code: string;
  name: string;
  assignments: { unitCode: string; startDate: string; endDateExclusive: string | null }[];
}
interface Page<T> {
  items: T[];
  total: number;
}
interface Summary {
  asOf: string;
  total: number;
  byUnit: { unitId: string; count: number }[];
}

const TYPE_STYLE: Record<string, string> = {
  DIVISION: 'bg-violet-50 text-violet-800 ring-violet-200',
  BRANCH: 'bg-blue-50 text-blue-800 ring-blue-200',
  COST_CENTER: 'bg-amber-50 text-amber-900 ring-amber-200',
};

const formatDate = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });

/** Urutkan unit sebagai pohon (induk lalu anaknya). Induk di luar cakupan diperlakukan sebagai akar. */
function asTree(units: Unit[]): { unit: Unit; depth: number }[] {
  const ids = new Set(units.map((u) => u.id));
  const children = new Map<string | null, Unit[]>();
  for (const u of units) {
    const parent = u.parentId && ids.has(u.parentId) ? u.parentId : null;
    children.set(parent, [...(children.get(parent) ?? []), u]);
  }
  const out: { unit: Unit; depth: number }[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const u of (children.get(parent) ?? []).sort((a, b) => a.code.localeCompare(b.code))) {
      out.push({ unit: u, depth });
      walk(u.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

/** Master data dalam cakupan pengguna: unit, karyawan, dan jumlah karyawan aktif hari ini. */
export function OrganizationPage() {
  const [units, setUnits] = useState<Unit[] | null>(null);
  const [employees, setEmployees] = useState<Employee[] | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const { can } = useAuth();
  const canManage = can('org.manage');

  useEffect(() => {
    Promise.all([
      apiFetch<Page<Unit>>('/org-units?pageSize=100'),
      apiFetch<Page<Employee>>('/employees?pageSize=100'),
      apiFetch<Summary>('/employees/summary'),
    ])
      .then(([u, e, s]) => {
        setUnits(u.items);
        setEmployees(e.items);
        setSummary(s);
      })
      .catch((err) =>
        setError(
          err instanceof ApiRequestError && err.status === 403
            ? 'Akun Anda tidak memiliki izin melihat data organisasi.'
            : 'Data organisasi gagal dimuat. Coba muat ulang halaman.',
        ),
      );
  }, []);

  if (error) return <p className="rounded-lg bg-red-50 p-4 text-sm text-red-800 ring-1 ring-red-200">{error}</p>;
  if (!units || !employees || !summary) return <LoadingBlock variant="page" label="Memuat data organisasi…" />;

  const editingUnit = units.find((u) => u.id === editing) ?? null;
  const countByUnit = new Map(summary.byUnit.map((u) => [u.unitId, u.count]));
  const orgNames = [...new Set(units.map((u) => u.organization.name))];
  const branches = units.filter((u) => u.type === 'BRANCH').length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Organisasi</h1>
        <p className="mt-1 text-sm text-slate-600">Struktur unit dan karyawan. Hanya unit dan karyawan dalam cakupan akses Anda yang ditampilkan.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon="building" tone="bg-violet-100 text-violet-700" value={orgNames.length === 1 ? orgNames[0] : `${orgNames.length} organisasi`} label="Organisasi" />
        <Stat icon="org" tone="bg-blue-100 text-blue-700" value={String(units.length)} label="Unit kerja" />
        <Stat icon="home" tone="bg-sky-100 text-sky-700" value={String(branches)} label="Cabang" />
        <Stat icon="users" tone="bg-emerald-100 text-emerald-700" value={String(summary.total)} label={`Karyawan aktif per ${formatDate(summary.asOf)}`} />
      </div>

      {notice && (
        <div role="status" className="flex items-start gap-3 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-900 ring-1 ring-emerald-200">
          <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white" aria-hidden="true">
            <Icon name="check" className="h-3.5 w-3.5" />
          </span>
          <p className="flex-1">{notice}</p>
          <button type="button" onClick={() => setNotice(null)} aria-label="Tutup pemberitahuan" className="rounded p-0.5 text-emerald-700 hover:bg-emerald-100">
            <Icon name="close" className="h-4 w-4" />
          </button>
        </div>
      )}

      <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
        <header className="flex items-center gap-3 border-b border-slate-100 px-5 py-4">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-100 text-blue-700">
            <Icon name="org" className="h-5 w-5" />
          </span>
          <div>
            <h2 className="text-base font-semibold text-slate-900">Unit kerja ({units.length})</h2>
            <p className="text-xs text-slate-500">Disusun mengikuti hierarki: divisi → cabang → cost center.</p>
          </div>
        </header>
        <div className="relative overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-2.5 font-medium">Kode</th>
                <th className="px-5 py-2.5 font-medium">Nama</th>
                <th className="px-5 py-2.5 font-medium">Jenis</th>
                <th className="px-5 py-2.5 font-medium">Organisasi</th>
                <th className="px-5 py-2.5 text-right font-medium">Karyawan aktif</th>
                {canManage && (
                  <th className="px-5 py-2.5 font-medium">
                    <span className="sr-only">Aksi</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {asTree(units).map(({ unit: u, depth }) => {
                const count = countByUnit.get(u.id) ?? 0;
                return (
                  <tr key={u.id} className="transition hover:bg-slate-50">
                    <td className="px-5 py-3">
                      <span className="inline-flex items-center" style={{ paddingLeft: `${depth * 20}px` }}>
                        {depth > 0 && (
                          <span aria-hidden="true" className="mr-1.5 text-slate-300">
                            └
                          </span>
                        )}
                        <span className="rounded-md bg-slate-100 px-2 py-0.5 font-mono text-xs font-semibold text-slate-700">{u.code}</span>
                      </span>
                    </td>
                    <td className="px-5 py-3 font-medium text-slate-900">{u.name}</td>
                    <td className="px-5 py-3">
                      <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ${TYPE_STYLE[u.type] ?? 'bg-slate-100 text-slate-700 ring-slate-200'}`}>{unitTypeLabel(u.type)}</span>
                    </td>
                    <td className="px-5 py-3 text-slate-600">{u.organization.name}</td>
                    <td className="px-5 py-3 text-right">
                      <span className={`inline-flex items-center gap-1.5 tabular-nums ${count > 0 ? 'font-semibold text-slate-900' : 'text-slate-400'}`}>
                        <Icon name="users" className="h-4 w-4" />
                        {count}
                      </span>
                    </td>
                    {canManage && (
                      <td className="px-5 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => {
                            setNotice(null);
                            setEditing(u.id);
                          }}
                          aria-label={`Ubah nama unit ${u.code}`}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-blue-700 ring-1 ring-blue-300 transition hover:bg-blue-700 hover:text-white hover:ring-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                        >
                          <Icon name="pencil" className="h-3.5 w-3.5" />
                          Ubah nama
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
        <header className="flex items-center gap-3 border-b border-slate-100 px-5 py-4">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700">
            <Icon name="users" className="h-5 w-5" />
          </span>
          <div>
            <h2 className="text-base font-semibold text-slate-900">Karyawan ({employees.length})</h2>
            <p className="text-xs text-slate-500">Riwayat penempatan dari yang terlama; penempatan yang masih berjalan ditandai Aktif.</p>
          </div>
        </header>
        {employees.length === 0 ? (
          <p className="px-5 py-6 text-center text-sm text-slate-600">Tidak ada karyawan dalam cakupan Anda.</p>
        ) : (
          <div className="relative overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-2.5 font-medium">Karyawan</th>
                  <th className="px-5 py-2.5 font-medium">Riwayat penempatan</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {employees.map((e) => (
                  <tr key={e.id} className="transition hover:bg-slate-50">
                    <td className="px-5 py-3">
                      <span className="flex items-center gap-3">
                        <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 text-xs font-semibold text-white">
                          {initials(e.name)}
                        </span>
                        <span>
                          <span className="block font-medium text-slate-900">{e.name}</span>
                          <span className="block font-mono text-xs text-slate-500">{e.code}</span>
                        </span>
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <ol className="flex flex-wrap items-center gap-1.5" aria-label={`Riwayat penempatan ${e.name}`}>
                        {e.assignments.map((a, i) => {
                          const active = a.endDateExclusive === null;
                          return (
                            <li key={`${a.unitCode}-${a.startDate}`} className="flex items-center gap-1.5">
                              {i > 0 && (
                                <span aria-hidden="true" className="text-slate-300">
                                  →
                                </span>
                              )}
                              <span
                                className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs ring-1 ${active ? 'bg-emerald-50 text-emerald-900 ring-emerald-200' : 'bg-slate-50 text-slate-600 ring-slate-200'}`}
                              >
                                <span className="font-semibold">{a.unitCode}</span>
                                <span>
                                  {formatDate(a.startDate)} – {a.endDateExclusive ? formatDate(a.endDateExclusive) : 'sekarang'}
                                </span>
                                {active && <span className="rounded-full bg-emerald-600 px-1.5 text-[10px] font-semibold uppercase text-white">Aktif</span>}
                              </span>
                            </li>
                          );
                        })}
                      </ol>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {editingUnit && (
        <RenameUnitDialog
          unit={editingUnit}
          onClose={() => setEditing(null)}
          onSaved={(name) => {
            setUnits((prev) => prev && prev.map((x) => (x.id === editingUnit.id ? { ...x, name } : x)));
            setEditing(null);
            setNotice(`Nama unit ${editingUnit.code} diubah menjadi “${name}”. Perubahan tercatat di audit.`);
          }}
        />
      )}
    </div>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

function Stat({ icon, tone, value, label }: { icon: IconName; tone: string; value: string; label: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${tone}`}>
        <Icon name={icon} className="h-5 w-5" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-lg font-semibold leading-tight text-slate-900">{value}</span>
        <span className="block truncate text-xs font-medium text-slate-500">{label}</span>
      </span>
    </div>
  );
}
