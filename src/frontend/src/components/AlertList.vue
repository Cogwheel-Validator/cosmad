<script setup lang="ts">
import { onUnmounted, ref, watch } from "vue";
import type { AlertJson, SseEvent } from "../types";

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

const props = defineProps<{ chainId: string }>();

const alerts = ref<AlertJson[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);

let es: EventSource | null = null;

async function fetchAlerts() {
  loading.value = true;
  error.value = null;
  try {
    const res = await fetch(`/api/chains/${props.chainId}/alerts`);
    const data = (await res.json()) as { alerts: AlertJson[] };
    alerts.value = data.alerts ?? [];
  } catch (e) {
    error.value = String(e);
  } finally {
    loading.value = false;
  }
}

function connectSse() {
  es?.close();
  es = new EventSource("/events");

  es.addEventListener("alert_opened", (e) => {
    const event = JSON.parse(e.data) as SseEvent & { type: "alert_opened" };
    if (event.chainId !== props.chainId) return;
    alerts.value = [event.data, ...alerts.value];
  });

  es.addEventListener("alert_closed", (e) => {
    const event = JSON.parse(e.data) as SseEvent & { type: "alert_closed" };
    if (event.chainId !== props.chainId) return;
    alerts.value = alerts.value.filter((a) => a.alertId !== event.alertId);
  });

  es.onerror = () => {
    setTimeout(connectSse, 3_000);
  };
}

watch(
  () => props.chainId,
  () => {
    fetchAlerts();
  },
  { immediate: true },
);

connectSse();

onUnmounted(() => es?.close());
</script>

<template>
  <aside
    class="flex flex-col border-b lg:border-b-0 lg:border-r border-base-300 lg:min-h-[calc(100vh-4rem)]"
  >
    <div class="flex items-center justify-between px-4 py-3 border-b border-base-300">
      <span class="text-xs font-semibold uppercase tracking-wide text-base-content/60">Open Alerts</span>
      <span v-if="!loading" class="badge badge-sm" :class="alerts.length > 0 ? 'badge-error' : 'badge-success'">
        {{ alerts.length }}
      </span>
    </div>

    <div v-if="loading" class="text-center text-sm text-base-content/60 py-8">Loading…</div>
    <div v-else-if="error" class="alert alert-error m-3">{{ error }}</div>
    <div v-else-if="alerts.length === 0" class="text-center text-sm text-base-content/60 py-8">
      No open alerts
    </div>

    <ul v-else class="divide-y divide-base-300">
      <li
        v-for="alert in alerts"
        :key="alert.alertId"
        class="px-4 py-2.5 flex items-center justify-between gap-2 hover:bg-base-200/50"
      >
        <div class="text-sm font-mono text-error">{{ alert.alertType }}</div>
        <time class="text-[11px] text-base-content/60 whitespace-nowrap" :title="alert.openedAt">
          {{ relativeTime(alert.openedAt) }}
        </time>
      </li>
    </ul>
  </aside>
</template>
