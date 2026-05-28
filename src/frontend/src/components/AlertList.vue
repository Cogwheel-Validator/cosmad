<script setup lang="ts">
import { ref, watch, onUnmounted } from "vue";
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
  <aside class="panel">
    <div class="panel-header">
      <span class="panel-title">Open Alerts</span>
      <span v-if="!loading" class="badge" :class="alerts.length > 0 ? 'badge-red' : 'badge-green'">
        {{ alerts.length }}
      </span>
    </div>

    <div v-if="loading" class="state">Loading…</div>
    <div v-else-if="error" class="state state-error">{{ error }}</div>
    <div v-else-if="alerts.length === 0" class="state">No open alerts</div>

    <ul v-else class="alert-list">
      <li v-for="alert in alerts" :key="alert.alertId" class="alert-item">
        <div class="alert-type">{{ alert.alertType }}</div>
        <div class="alert-meta">
          <time :title="alert.openedAt">{{ relativeTime(alert.openedAt) }}</time>
        </div>
      </li>
    </ul>
  </aside>
</template>

<style scoped>
.panel {
  border-right: 1px solid var(--border);
  min-height: calc(100vh - 52px);
  display: flex;
  flex-direction: column;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px 10px;
  border-bottom: 1px solid var(--border);
}

.panel-title {
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-muted);
}

.badge {
  font-size: 11px;
  font-weight: 700;
  padding: 1px 7px;
  border-radius: 10px;
}
.badge-red { background: rgba(248, 81, 73, 0.15); color: var(--red); }
.badge-green { background: rgba(63, 185, 80, 0.15); color: var(--green); }

.state {
  padding: 24px 16px;
  color: var(--text-muted);
  font-size: 13px;
  text-align: center;
}
.state-error { color: var(--red); }

.alert-list { list-style: none; }

.alert-item {
  padding: 10px 16px;
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.alert-item:hover { background: rgba(255,255,255,0.03); }

.alert-type {
  font-size: 13px;
  font-family: var(--font-mono);
  color: var(--red);
}

.alert-meta {
  font-size: 11px;
  color: var(--text-muted);
  white-space: nowrap;
}
</style>
