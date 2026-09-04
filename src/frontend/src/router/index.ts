import { createRouter, createWebHistory } from "vue-router";
import ChainView from "../views/ChainView.vue";
import DashboardView from "../views/DashboardView.vue";

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", name: "dashboard", component: DashboardView },
    { path: "/chains/:chainId", name: "chain", component: ChainView, props: true },
  ],
});
