<script setup lang="ts">
import type { EChartsOption } from "echarts";
import { computed, onUnmounted, ref, watch } from "vue";
import VChart from "vue-echarts";
import { fetchJson } from "../api";
import { sseHub } from "../sse";
import type { BlockJson } from "../types";

const props = withDefaults(
  defineProps<{
    chainId: string;
    limit?: number;
    height?: number;
    animate?: boolean;
  }>(),
  {
    limit: 100,
    height: 40,
    animate: false,
  },
);

const blocks = ref<BlockJson[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);

// -1 = not in active set, 0 = active but missed, 1 = active and signed.
const COLORS: Record<number, string> = {
  1: "#3fb950",
  0: "#f85149",
  "-1": "#30363d",
};

async function load() {
  loading.value = true;
  error.value = null;
  try {
    const data = await fetchJson<{ blocks: BlockJson[] }>(
      `/api/v1/chains/${props.chainId}/blocks/recent?limit=${props.limit}`,
    );
    blocks.value = data.blocks;
  } catch (e) {
    error.value = String(e);
  } finally {
    loading.value = false;
  }
}

watch(() => [props.chainId, props.limit], load, { immediate: true });

// Live-append new blocks over the shared SSE connection so the strip stays current between
// polls.
const unsubscribe = sseHub.subscribe("block", (event) => {
  if (event.chainId !== props.chainId) return;
  const next = [...blocks.value, event.data];
  blocks.value = next.length > props.limit ? next.slice(next.length - props.limit) : next;
});

onUnmounted(unsubscribe);

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function statusLabel(signed: number): string {
  if (signed === 1) return "Signed";
  if (signed === 0) return "Missed";
  return "Not in active set";
}

const option = computed<EChartsOption>(() => ({
  animation: props.animate,
  grid: { left: 0, right: 0, top: 2, bottom: 0 },
  xAxis: { type: "category", show: false, data: blocks.value.map((b) => b.height) },
  yAxis: { type: "value", show: false, max: 1 },
  tooltip: {
    trigger: "item",
    formatter: (params) => {
      const p = Array.isArray(params) ? params[0] : params;
      const block = blocks.value[p.dataIndex as number];
      if (!block) return "";
      return `Height ${block.height}<br/>${formatTime(block.time)}<br/>${statusLabel(block.signed)}`;
    },
  },
  series: [
    {
      type: "bar",
      data: blocks.value.map((b) => ({
        value: 1,
        itemStyle: { color: COLORS[b.signed] ?? COLORS[-1] },
      })),
      barGap: "10%",
      barCategoryGap: "20%",
      silent: false,
    },
  ],
}));
</script>

<template>
  <div class="w-full">
    <div v-if="loading" class="text-xs text-base-content/60 py-2">Loading…</div>
    <div v-else-if="error" class="text-xs text-error py-2">{{ error }}</div>
    <div v-else-if="blocks.length === 0" class="text-xs text-base-content/60 py-2">No block data yet</div>
    <VChart v-else class="w-full" :option="option" :style="{ height: `${height}px` }" autoresize />
  </div>
</template>
