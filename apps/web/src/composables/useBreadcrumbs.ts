import { computed, ref } from 'vue';
import { useRoute, type RouteLocationRaw } from 'vue-router';

export interface Crumb {
  label: string;
  to?: RouteLocationRaw;
}

const pageCrumbs = ref<Crumb[] | null>(null);

/**
 * Sets the trail of a page that knows it only once loaded, such as an
 * environment and its project; null goes back to the route's. The router
 * clears it at every navigation.
 */
export function setBreadcrumbs(crumbs: Crumb[] | null) {
  pageCrumbs.value = crumbs;
}

/** The trail of the top bar: the page's own, or the `crumbs` of its route. */
export function useBreadcrumbs() {
  const route = useRoute();
  return computed<Crumb[]>(() => pageCrumbs.value ?? route.meta.crumbs ?? []);
}
