import type { AppConfig } from "../config.js";
import { LeaseConflictError } from "../domain/errors.js";
import type { LeaseRepository } from "../persistence/repositories/lease-repository.js";
import type { BridgeRepository } from "../persistence/repositories/bridge-repository.js";

export class BridgeLeaseManager {
  constructor(
    private readonly leases: LeaseRepository,
    private readonly bridges: BridgeRepository,
    private readonly config: AppConfig,
    private readonly holderId: string,
  ) {}

  async acquire(bridgeId: string): Promise<{ epoch: number }> {
    const epoch = await this.bridges.incrementLeaseEpoch(bridgeId);
    const expiresAt = new Date(Date.now() + this.config.leaseTtlSeconds * 1000);
    const ok = await this.leases.upsert({ bridgeId, holderId: this.holderId, epoch, expiresAt });
    if (!ok) throw new LeaseConflictError();
    return { epoch };
  }

  async renew(bridgeId: string, epoch: number): Promise<void> {
    const current = await this.leases.get(bridgeId);
    if (!current || current.holderId !== this.holderId || current.epoch !== epoch) {
      throw new LeaseConflictError();
    }
    const expiresAt = new Date(Date.now() + this.config.leaseTtlSeconds * 1000);
    await this.leases.upsert({ bridgeId, holderId: this.holderId, epoch, expiresAt });
  }

  async release(bridgeId: string): Promise<void> {
    await this.leases.release(bridgeId, this.holderId);
  }
}
