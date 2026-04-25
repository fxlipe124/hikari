import { useEffect, useRef } from "react";
import { useVaultStore } from "./useVaultStore";
import { toast } from "@/lib/toast";
import i18n from "@/lib/i18n";

const ACTIVITY_EVENTS = ["mousemove", "mousedown", "keydown", "wheel", "touchstart"];

/**
 * Lock the vault after `minutes` of user inactivity.
 * Only active while the vault is unlocked.
 */
export function useAutolock(minutes: number) {
  const status = useVaultStore((s) => s.status);
  const lock = useVaultStore((s) => s.lock);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (status !== "unlocked") return;
    const ms = Math.max(60_000, minutes * 60_000);

    const reset = () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => {
        toast.info(i18n.t("toast.vault_locked_inactivity"), i18n.t("toast.inactivity_detected"));
        lock();
      }, ms);
    };

    reset();
    for (const ev of ACTIVITY_EVENTS) {
      window.addEventListener(ev, reset, { passive: true });
    }
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
      for (const ev of ACTIVITY_EVENTS) {
        window.removeEventListener(ev, reset);
      }
    };
  }, [status, minutes, lock]);
}
