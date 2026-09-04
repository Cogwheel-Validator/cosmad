<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{ src: string }>();

const normalized = computed(() =>
  props.src.replace(/\sfill="(?!none)[^"]*"/g, "").replace(/\sstroke="(?!none)[^"]*"/g, ""),
);
</script>

<template>
  <span class="inline-svg" v-html="normalized" />
</template>

<style scoped>
.inline-svg {
  display: inline-flex;
}
.inline-svg :deep(svg) {
  width: 100%;
  height: 100%;
  fill: currentColor;
  stroke: currentColor;
}
</style>
