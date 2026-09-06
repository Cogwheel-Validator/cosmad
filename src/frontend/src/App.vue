<script setup lang="ts">
import { onMounted, ref } from "vue";
import Github from "/github.svg?raw";
import MenuIcon from "/menu.svg?raw";
import StatsIcon from "/stats.svg?raw";
import { fetchJson } from "./api";
import InlineSvg from "./components/InlineSvg.vue";

// Nav links live here so adding a future page (e.g. an "Alerts" overview) is a one-line change.
const navLinks = [{ to: "/", label: "Dashboard", icon: StatsIcon }];

const chains = ref<string[]>([]);
const loading = ref(true);

onMounted(async () => {
  try {
    const data = await fetchJson<{ chains: string[] }>("/api/v1/chains");
    chains.value = data.chains ?? [];
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div class="min-h-screen flex flex-col">
    <div class="navbar bg-base-200 border-b border-base-300 sticky top-0 z-20 px-2! sm:px-3! md:px-4!">
      <div class="navbar-start">
        <div class="dropdown" v-if="navLinks.length > 1">
          <div tabindex="0" role="button" class="btn btn-ghost btn-md btn-square lg:hidden" aria-label="Open menu">
            <InlineSvg :src="MenuIcon" class="h-6 w-6 text-base-content" />
          </div>
          <ul tabindex="0" class="menu menu-sm dropdown-content bg-base-200 rounded-box z-30 mt-3 w-48 shadow border border-base-300">
            <li v-for="link in navLinks" :key="link.to">
              <RouterLink :to="link.to" exact-active-class="active"><InlineSvg :src="link.icon" class="h-6 w-6" />{{ link.label }}</RouterLink>
            </li>
          </ul>
        </div>
        <RouterLink to="/" class="btn btn-ghost text-lg">
          <span class="text-primary">⬡</span> cosmad
        </RouterLink>
      </div>

      <div class="navbar-center hidden lg:flex">
        <ul class="menu menu-horizontal px-1 space-x-4">
          <li v-for="link in navLinks" :key="link.to">
            <RouterLink :to="link.to" class="btn btn-soft btn-primary btn-md p-4 " exact-active-class="active">
              <InlineSvg :src="link.icon" class="h-6 w-6" />
              {{ link.label }}</RouterLink>
          </li>
        </ul>
      </div>

      <div class="navbar-end">
        <a href="https://github.com/Cogwheel-Validator/cosmad" target="_blank" class="btn btn-outline btn-primary btn-sm">
          <InlineSvg :src="Github" class="h-6 w-6" />
        </a>
      </div>
    </div>

    <main class="flex-1 flex flex-col items-stretch w-full">
      <div v-if="loading" class="flex justify-center items-center py-24">
        <span class="loading loading-spinner loading-lg text-primary"></span>
      </div>

      <div v-else-if="chains.length === 0" class="alert alert-info max-w-md mx-auto mt-16">
        <span>
          No chains configured. Add entries to <code class="font-mono">config.chains</code> in
          <code class="font-mono">src/runner.ts</code>.
        </span>
      </div>

      <RouterView v-else />
    </main>
  </div>
</template>
