import { PrismaClient } from '@prisma/client';
import type { ApprovalHooks } from '../../src/modules/approvals/approvals.service';

/**
 * Koordinasi agar dua transaksi benar-benar tumpang tindih: transaksi pertama berhenti tepat sebelum commit
 * (masih memegang row lock) sampai test melepasnya; test memastikan transaksi kedua MENUNGGU lock di
 * PostgreSQL (pg_stat_activity) sebelum melepas yang pertama.
 */
export class HoldBeforeCommit {
  private armed: string | null = null;
  private enteredResolve: () => void = () => undefined;
  private releaseResolve: () => void = () => undefined;
  entered: Promise<void> = Promise.resolve();
  private released: Promise<void> = Promise.resolve();

  readonly hooks: ApprovalHooks = {
    beforeCommit: async (e) => {
      if (this.armed !== e.kind) return;
      this.armed = null;
      this.enteredResolve();
      await this.released;
    },
  };

  /** Tahan transaksi berikutnya dengan jenis ini (SUBMIT/APPROVE/REJECT/DELEGATE). */
  arm(kind: string) {
    this.armed = kind;
    this.entered = new Promise((r) => (this.enteredResolve = r));
    this.released = new Promise((r) => (this.releaseResolve = r));
  }

  release() {
    this.releaseResolve();
  }
}

/**
 * Tunggu sampai ada transaksi yang MENUNGGU lock baris (lock belum granted). Memakai pg_locks karena
 * pg_stat_activity menyembunyikan wait_event sesi role lain bagi non-superuser (app_owner ≠ app_runtime).
 * Menunggu FOR UPDATE pada baris yang dikunci transaksi lain tampil sebagai lock transactionid/tuple.
 */
export async function waitForLockWaiter(owner: PrismaClient, timeoutMs = 5000): Promise<number> {
  const start = Date.now();
  for (;;) {
    const [row] = await owner.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM pg_locks WHERE NOT granted AND locktype IN ('transactionid', 'tuple')`;
    if (Number(row.n) > 0) return Number(row.n);
    if (Date.now() - start > timeoutMs) throw new Error('Transaksi kedua tidak terlihat menunggu lock — race tidak terbukti');
    await new Promise((r) => setTimeout(r, 20));
  }
}
