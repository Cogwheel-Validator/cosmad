<script setup lang="ts">
import { ref, onMounted } from "vue";
import BlockFeed from "./components/BlockFeed.vue";
import AlertList from "./components/AlertList.vue";

const chains = ref<string[]>([]);
const selectedChain = ref<string | null>(null);
const loading = ref(true);

onMounted(async () => {
  try {
    const res = await fetch("/api/chains");
    const data = (await res.json()) as { chains: string[] };
    chains.value = data.chains ?? [];
    if (chains.value.length > 0) {
      selectedChain.value = chains.value[0] ?? null;
    }
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div class="layout">
    <header class="header">
      <span class="logo">⬡ cosmad</span>
      <nav v-if="chains.length > 0" class="chain-nav">
        <button
          v-for="chain in chains"
          :key="chain"
          :class="['chain-btn', { active: selectedChain === chain }]"
          @click="selectedChain = chain"
        >
          {{ chain }}
        </button>
      </nav>
    </header>

    <main class="main">
      <div v-if="loading" class="empty">Loading…</div>

      <div v-else-if="chains.length === 0" class="empty">
        No chains configured. Add entries to <code>config.chains</code> in
        <code>src/runner.ts</code>.
      </div>

      <template v-else-if="selectedChain">
        <AlertList :chain-id="selectedChain" />
        <BlockFeed :chain-id="selectedChain" />
      </template>
    </main>
  </div>
</template>

<style scoped>
.layout {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
}

.header {
  display: flex;
  align-items: center;
  gap: 24px;
  padding: 0 24px;
  height: 52px;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
  position: sticky;
  top: 0;
  z-index: 10;
}

.logo {
  font-size: 16px;
  font-weight: 600;
  color: var(--accent);
  letter-spacing: 0.02em;
}

.chain-nav {
  display: flex;
  gap: 4px;
}

.chain-btn {
  padding: 4px 12px;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 13px;
  transition: all 0.15s;
}

.chain-btn:hover { color: var(--text); border-color: var(--text-muted); }
.chain-btn.active { color: var(--accent); border-color: var(--accent); background: rgba(88, 166, 255, 0.08); }

.main {
  flex: 1;
  display: grid;
  grid-template-columns: 340px 1fr;
  gap: 0;
  align-items: start;
}

.empty {
  grid-column: 1 / -1;
  padding: 64px 24px;
  text-align: center;
  color: var(--text-muted);
}

.empty code {
  font-family: var(--font-mono);
  background: var(--surface);
  padding: 2px 6px;
  border-radius: 4px;
}
</style>
