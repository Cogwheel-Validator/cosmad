<script setup lang="ts">
import { useQuery } from "@tanstack/vue-query";
import { fetchJson } from "../api";
import ChainCard from "../components/ChainCard.vue";
import DailyUptimeChart from "../components/DailyUptimeChart.vue";
import RefreshNotice from "../components/RefreshNotice.vue";
import type { OverviewJson } from "../types";

const DAYS = 30;
const REFRESH_INTERVAL_MS = 60_000;

const {
  data: overview,
  isLoading,
  isError,
  error,
  dataUpdatedAt,
} = useQuery({
  queryKey: ["overview", DAYS],
  queryFn: () => fetchJson<OverviewJson>(`/api/v1/overview?days=${DAYS}`),
  refetchInterval: REFRESH_INTERVAL_MS,
});

function formatPercent(pct: number | null): string {
  return pct != null ? `${(pct * 100).toFixed(2)}%` : "n/a";
}
</script>

<template>
  <div class="flex flex-col gap-6 w-full p-4 md:p-6">
    <div v-if="isLoading" class="flex justify-center items-center py-24">
      <span class="loading loading-spinner loading-lg text-primary"></span>
    </div>
    <div v-else-if="isError" class="alert alert-error">{{ error?.message }}</div>

    <template v-else-if="overview">
      <section class="card bg-base-200 border border-base-300">
        <div class="flex items-center justify-between px-4 py-3 border-b border-base-300">
          <span class="text-xs font-semibold uppercase tracking-wide text-base-content/60">
            Overall performance — last {{ overview.days }} days
          </span>
          <RefreshNotice :updated-at="dataUpdatedAt" :interval-ms="REFRESH_INTERVAL_MS" />
        </div>
        <div class="card-body gap-4!">
          <div class="flex flex-col gap-0.5">
            <span class="text-3xl font-bold">{{ formatPercent(overview.combined.percentageSigned) }}</span>
            <span class="text-xs text-base-content/60">signed across all chains</span>
            <span class="text-[11px] text-base-content/60">
              missed {{ overview.combined.missedBlocks }} / {{ overview.combined.totalBlocks }} blocks
            </span>
          </div>
          <DailyUptimeChart :daily="overview.combined.daily" :height="200" />
        </div>
      </section>

      <section>
        <h2 class="text-xs font-semibold uppercase tracking-wide text-base-content/60 mb-3">Chains</h2>
        <div v-if="overview.chains.length === 0" class="text-center text-sm text-base-content/60 py-16">
          No chains configured
        </div>
        <div v-else class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          <ChainCard v-for="chain in overview.chains" :key="chain.chainId" :chain="chain" />
        </div>
      </section>
    </template>
  </div>
</template>
