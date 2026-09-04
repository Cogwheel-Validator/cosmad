<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";

const props = defineProps<{
  updatedAt: number | undefined;
  intervalMs: number;
}>();

const now = ref(Date.now());
let timer: ReturnType<typeof setInterval> | null = null;

onMounted(() => {
  timer = setInterval(() => {
    now.value = Date.now();
  }, 1_000);
});

onUnmounted(() => {
  if (timer) clearInterval(timer);
});

function relativeUpdated(): string {
  if (!props.updatedAt) return "loading…";
  const secs = Math.max(0, Math.floor((now.value - props.updatedAt) / 1000));
  if (secs < 5) return "just now";
  if (secs < 60) return `${secs}s ago`;
  return `${Math.floor(secs / 60)}m ago`;
}
</script>

<template>
  <span class="text-[11px] text-base-content/60">
    updated {{ relativeUpdated() }} · refreshes every {{ Math.round(intervalMs / 1000) }}s
  </span>
</template>
