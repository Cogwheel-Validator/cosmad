<script setup lang="ts">
import type { ChainOverviewJson } from "../types";
import UptimeStrip from "./UptimeStrip.vue";

defineProps<{ chain: ChainOverviewJson }>();

function formatPercent(pct: number | null): string {
  return pct != null ? `${(pct * 100).toFixed(2)}%` : "n/a";
}

function relativeTime(iso: string | null): string {
  if (!iso) return "never";
  const diff = Date.now() - new Date(iso).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ago`;
}

function dotClass(status: string): string {
  if (status === "online") return "bg-success shadow-[0_0_0_3px_rgba(74,222,128,0.2)]";
  if (status === "offline") return "bg-error";
  if (status === "stalled") return "bg-warning shadow-[0_0_0_3px_rgba(234,179,8,0.2)]";
  return "bg-base-300";
}
</script>

<template>
  <RouterLink
    :to="`/chains/${chain.chainId}`"
    class="card bg-base-200 border border-base-300 hover:border-primary transition-colors no-underline"
  >
    <div class="card-body p-4! gap-2">
      <div class="flex items-center justify-between">
        <span class="text-sm font-semibold text-base-content">{{ chain.prettyName }}</span>
        <span class="w-2 h-2 rounded-full shrink-0" :class="dotClass(chain.status)" :title="chain.status" />
      </div>

      <div class="flex justify-between text-xs">
        <span class="font-mono">#{{ chain.latestHeight ?? "—" }}</span>
        <span class="text-base-content/60">{{ relativeTime(chain.latestBlockTime) }}</span>
      </div>

      <UptimeStrip :chain-id="chain.chainId" :limit="100" :height="28" />

      <div class="flex justify-between items-center mt-1 text-xs">
        <span class="font-bold" :class="(chain.percentageSigned ?? 1) < 0.99 ? 'text-warning' : 'text-success'">
          {{ formatPercent(chain.percentageSigned) }} signed
        </span>
        <span class="text-[11px] text-base-content/60">
          missed {{ chain.missedBlocks }} / {{ chain.totalBlocks }}
        </span>
      </div>
    </div>
  </RouterLink>
</template>
