<script setup lang="ts">
import { useQuery } from "@tanstack/vue-query";
import { computed } from "vue";
import { fetchJson } from "../api";
import AlertList from "../components/AlertList.vue";
import BlockFeed from "../components/BlockFeed.vue";
import DailyUptimeChart from "../components/DailyUptimeChart.vue";
import RefreshNotice from "../components/RefreshNotice.vue";
import UptimeStrip from "../components/UptimeStrip.vue";
import type { ChainStatsJson } from "../types";

const DAYS = 30;
// Same reasoning as the dashboard: the 30-day rollup is polled, not SSE-driven - only the
// 100-block uptime strip below gets live updates.
const REFRESH_INTERVAL_MS = 60_000;

const props = defineProps<{ chainId: string }>();

const {
  data: stats,
  isLoading,
  isError,
  error,
  dataUpdatedAt,
} = useQuery({
  queryKey: computed(() => ["chainStats", props.chainId, DAYS] as const),
  queryFn: () => fetchJson<ChainStatsJson>(`/api/v1/chains/${props.chainId}/stats?days=${DAYS}`),
  refetchInterval: REFRESH_INTERVAL_MS,
});

function formatPercent(pct: number | null): string {
  return pct != null ? `${(pct * 100).toFixed(2)}%` : "n/a";
}
</script>

<template>
  <div class="flex flex-col w-full">
    <section class="card bg-base-200 border border-base-300 mx-4 md:mx-6 mt-4 md:mt-6">
      <div class="flex items-center justify-between px-4 py-3 border-b border-base-300">
        <span class="text-xs font-semibold uppercase tracking-wide text-base-content/60">
          {{ chainId }} — last 100 blocks
        </span>
        <RefreshNotice :updated-at="dataUpdatedAt" :interval-ms="REFRESH_INTERVAL_MS" />
      </div>
      <div class="card-body gap-4!">
        <UptimeStrip :chain-id="chainId" :limit="100" :height="48" :animate="true" />

        <div v-if="isLoading" class="flex justify-center items-center py-8">
          <span class="loading loading-spinner text-primary"></span>
        </div>
        <div v-else-if="isError" class="alert alert-error">{{ error?.message }}</div>
        <template v-else-if="stats">
          <div class="flex flex-col gap-0.5">
            <span class="text-2xl font-bold">{{ formatPercent(stats.percentageSigned) }}</span>
            <span class="text-xs text-base-content/60">signed — last {{ stats.days }} days</span>
            <span class="text-[11px] text-base-content/60">
              missed {{ stats.missedBlocks }} / {{ stats.totalBlocks }} blocks
            </span>
          </div>
          <DailyUptimeChart :daily="stats.daily" :height="200" />
        </template>
      </div>
    </section>

    <div class="flex-1 grid grid-cols-1 lg:grid-cols-[340px_1fr] items-start mt-4 md:mt-6">
      <AlertList :chain-id="chainId" />
      <BlockFeed :chain-id="chainId" />
    </div>
  </div>
</template>
