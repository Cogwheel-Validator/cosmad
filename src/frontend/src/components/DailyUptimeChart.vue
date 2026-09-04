<script setup lang="ts">
import type { EChartsOption } from "echarts";
import { computed } from "vue";
import VChart from "vue-echarts";
import type { DailyStatsJson } from "../types";

const props = defineProps<{
  daily: DailyStatsJson[];
  height?: number;
}>();

function barColor(pct: number | null): string {
  if (pct == null) return "#30363d";
  if (pct >= 0.99) return "#3fb950";
  if (pct >= 0.95) return "#d29922";
  return "#f85149";
}

function formatDate(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

const option = computed<EChartsOption>(() => ({
  grid: { left: 36, right: 12, top: 12, bottom: 24 },
  xAxis: {
    type: "category",
    data: props.daily.map((d) => formatDate(d.date)),
    axisLine: { lineStyle: { color: "#30363d" } },
    axisLabel: { color: "#8b949e", fontSize: 11 },
  },
  yAxis: {
    type: "value",
    min: 0,
    max: 100,
    axisLabel: { color: "#8b949e", fontSize: 11, formatter: "{value}%" },
    splitLine: { lineStyle: { color: "#30363d" } },
  },
  tooltip: {
    trigger: "axis",
    formatter: (params) => {
      const p = Array.isArray(params) ? params[0] : params;
      const day = props.daily[p.dataIndex as number];
      if (!day) return "";
      const pct =
        day.percentageSigned != null ? `${(day.percentageSigned * 100).toFixed(2)}%` : "n/a";
      return `${day.date}<br/>Signed: ${pct}<br/>Missed: ${day.missed} / ${day.total}`;
    },
  },
  series: [
    {
      type: "bar",
      data: props.daily.map((d) => ({
        value: d.percentageSigned != null ? +(d.percentageSigned * 100).toFixed(2) : 0,
        itemStyle: { color: barColor(d.percentageSigned) },
      })),
      barMaxWidth: 24,
    },
  ],
}));
</script>

<template>
  <div v-if="daily.length === 0" class="text-center text-sm text-base-content/60 py-6">No stats data yet</div>
  <VChart v-else class="w-full" :option="option" :style="{ height: `${height ?? 220}px` }" autoresize />
</template>
