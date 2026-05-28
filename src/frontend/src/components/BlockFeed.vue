<script setup lang="ts">
import { ref, watch, onUnmounted } from "vue";
import type { BlockJson, SseEvent } from "../types";

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
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
    const res = await fetch(`/api/chains/${props.chainId}/blocks/latest`);
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
  es = new EventSource("/events");

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
  <section class="feed">
    <div class="feed-header">
      <span class="feed-title">Block Feed</span>
      <span class="status-dot" :class="`dot-${status}`" :title="status" />
    </div>

    <div v-if="loading" class="state">Loading…</div>
    <div v-else-if="error" class="state state-error">{{ error }}</div>
    <div v-else-if="blocks.length === 0" class="state">Waiting for blocks…</div>

    <div v-else class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Height</th>
            <th>Time</th>
            <th>Signed</th>
            <th>Hash</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="block in blocks" :key="block.height" class="block-row">
            <td class="mono">{{ block.height }}</td>
            <td class="muted">{{ formatTime(block.time) }}</td>
            <td>
              <span :class="block.signed ? 'signed' : 'unsigned'">
                {{ block.signed ? "✓" : "✗" }}
              </span>
            </td>
            <td class="mono muted truncate">{{ block.hash.slice(0, 16) }}…</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<style scoped>
.feed {
  display: flex;
  flex-direction: column;
  min-height: calc(100vh - 52px);
}

.feed-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 20px 10px;
  border-bottom: 1px solid var(--border);
}

.feed-title {
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-muted);
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}
.dot-online { background: var(--green); box-shadow: 0 0 0 3px rgba(63,185,80,.2); }
.dot-offline { background: var(--red); }
.dot-unknown { background: var(--text-muted); }

.state {
  padding: 32px 20px;
  color: var(--text-muted);
  font-size: 13px;
  text-align: center;
}
.state-error { color: var(--red); }

.table-wrap { overflow-x: auto; }

table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

th {
  text-align: left;
  padding: 8px 20px;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
  position: sticky;
  top: 52px;
}

td { padding: 8px 20px; border-bottom: 1px solid var(--border); }

.block-row:hover td { background: rgba(255,255,255,0.02); }
.block-row:first-child td { color: var(--text); }

.mono { font-family: var(--font-mono); }
.muted { color: var(--text-muted); }
.truncate { max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.signed { color: var(--green); font-weight: 700; }
.unsigned { color: var(--red); font-weight: 700; }
</style>
