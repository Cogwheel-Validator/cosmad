<script setup lang="ts">
import { onUnmounted, ref, watch } from "vue";
import type { BlockJson, SseEvent } from "../types";

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

// -1 = not in active set, 0 = active but missed, 1 = active and signed.
function signedClass(signed: number): string {
  if (signed === 1) return "text-success font-bold";
  if (signed === 0) return "text-error font-bold";
  return "text-base-content/60 font-bold";
}

function signedLabel(signed: number): string {
  if (signed === 1) return "✓";
  if (signed === 0) return "✗";
  return "·";
}

function dotClass(status: string): string {
  if (status === "online") return "bg-success shadow-[0_0_0_3px_rgba(74,222,128,0.2)]";
  if (status === "offline") return "bg-error";
  if (status === "stalled") return "bg-warning shadow-[0_0_0_3px_rgba(234,179,8,0.2)]";
  return "bg-base-300";
}

const MAX_BLOCKS = 50;

const props = defineProps<{ chainId: string }>();

const blocks = ref<BlockJson[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);
const status = ref<"online" | "offline" | "unknown">("unknown");

let es: EventSource | null = null;

async function fetchLatest() {
  loading.value = true;
  error.value = null;
  try {
    const res = await fetch(`/api/v1/chains/${props.chainId}/blocks/latest`);
    const data = (await res.json()) as { block: BlockJson | null };
    if (data.block) {
      blocks.value = [data.block];
    }
  } catch (e) {
    error.value = String(e);
  } finally {
    loading.value = false;
  }
}

function connectSse() {
  es?.close();
  es = new EventSource("/api/v1/events");

  es.addEventListener("block", (e) => {
    const event = JSON.parse(e.data) as SseEvent & { type: "block" };
    if (event.chainId !== props.chainId) return;
    blocks.value = [event.data, ...blocks.value].slice(0, MAX_BLOCKS);
  });

  es.addEventListener("chain_status", (e) => {
    const event = JSON.parse(e.data) as SseEvent & { type: "chain_status" };
    if (event.chainId !== props.chainId) return;
    status.value = event.status;
  });

  es.onerror = () => {
    status.value = "offline";
    setTimeout(connectSse, 3_000);
  };
}

watch(
  () => props.chainId,
  () => {
    blocks.value = [];
    status.value = "unknown";
    fetchLatest();
  },
  { immediate: true },
);

connectSse();

onUnmounted(() => es?.close());
</script>

<template>
  <section class="flex flex-col lg:min-h-[calc(100vh-4rem)]">
    <div class="flex items-center justify-between px-4 sm:px-5 py-3 border-b border-base-300">
      <span class="text-xs font-semibold uppercase tracking-wide text-base-content/60">Block Feed</span>
      <span class="w-2 h-2 rounded-full shrink-0" :class="dotClass(status)" :title="status" />
    </div>

    <div v-if="loading" class="text-center text-sm text-base-content/60 py-8">Loading…</div>
    <div v-else-if="error" class="alert alert-error m-3">{{ error }}</div>
    <div v-else-if="blocks.length === 0" class="text-center text-sm text-base-content/60 py-8">
      Waiting for blocks…
    </div>

    <div v-else class="overflow-x-auto">
      <table class="table table-sm">
        <thead>
          <tr class="top-16 bg-base-200 z-10">
            <th class="text-xs uppercase tracking-wide text-base-content/60">Height</th>
            <th class="text-xs uppercase tracking-wide text-base-content/60">Time</th>
            <th class="text-xs uppercase tracking-wide text-base-content/60">Signed</th>
            <th class="text-xs uppercase tracking-wide text-base-content/60">Hash</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="block in blocks" :key="block.height" class="hover:bg-base-200/50">
            <td class="font-mono">{{ block.height }}</td>
            <td class="text-base-content/60">{{ formatTime(block.time) }}</td>
            <td>
              <span :class="signedClass(block.signed)">
                {{ signedLabel(block.signed) }}
              </span>
            </td>
            <td class="font-mono text-base-content/60 max-w-35 overflow-hidden text-ellipsis whitespace-nowrap">
              {{ block.hash.slice(0, 16) }}…
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
