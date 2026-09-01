import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { config } from "./config.js";

export class DailyGasCap {
  private capWei: bigint;
  private spentWei = 0n;
  private day: string;

  constructor(capWei: bigint) {
    this.capWei = capWei;
    this.day = new Date().toISOString().slice(0, 10);
  }

  private rollIfNewDay(): void {
    const today = new Date().toISOString().slice(0, 10);
    if (today !== this.day) {
      this.day = today;
      this.spentWei = 0n;
    }
  }

  tryReserve(_sender: string, estimatedGasWei: bigint): boolean {
    this.rollIfNewDay();
    if (this.spentWei + estimatedGasWei > this.capWei) {
      return false;
    }
    this.spentWei += estimatedGasWei;
    return true;
  }

  release(_sender: string, giveBackWei: bigint): void {
    this.rollIfNewDay();
    this.spentWei -= giveBackWei > this.spentWei ? this.spentWei : giveBackWei;
  }
}

let cachedCap: DailyGasCap | undefined;

export function dailyGasCap(): DailyGasCap {
  if (!cachedCap) {
    cachedCap = new DailyGasCap(config.paymasterDailyGasCapWei);
  }
  return cachedCap;
}

let cachedSigner: PrivateKeyAccount | undefined;

export function paymasterSigner(): PrivateKeyAccount {
  if (!cachedSigner) {
    cachedSigner = privateKeyToAccount(config.paymasterPrivateKey as `0x${string}`);
  }
  return cachedSigner;
}
