/** Akun fixture untuk demo/presentasi. Kata sandi tidak pernah disimpan di frontend. */
export interface DemoAccount {
  email: string;
  label: string;
  description: string;
}

export const DEMO_ACCOUNTS: DemoAccount[] = [
  { email: 'admin@example.test', label: 'Admin organisasi', description: 'Melihat seluruh data Demo Nusantara' },
  { email: 'hr@example.test', label: 'HR', description: 'Review performa & RPE Divisi 1' },
  { email: 'finance@example.test', label: 'Finance', description: 'Import & rekonsiliasi transaksi Divisi 1' },
  { email: 'manager-a@example.test', label: 'Manager Cabang A', description: 'Data dan persetujuan cabang BR-A' },
  { email: 'manager-a2@example.test', label: 'Manager Cabang A (2)', description: 'Approver kedua cabang BR-A' },
  { email: 'manager-b@example.test', label: 'Manager Cabang B', description: 'Data dan persetujuan cabang BR-B' },
  { email: 'employee-a@example.test', label: 'Pengaju', description: 'Mengajukan anggaran untuk BR-A' },
  { email: 'outsider@example.test', label: 'Admin organisasi lain', description: 'Hanya Demo Sejahtera (BR-X)' },
  { email: 'no-grant@example.test', label: 'Tanpa akses', description: 'Bisa masuk, tetapi tidak punya izin' },
];

export const SHOW_DEMO_ACCOUNTS = import.meta.env.VITE_SHOW_DEMO_ACCOUNTS !== 'false';
