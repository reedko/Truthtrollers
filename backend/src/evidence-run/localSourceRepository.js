export function createLocalSourceRepository({ search = null } = {}) {
  return Object.freeze({
    kind: search ? "injected_local_repository" : "disabled_no_database",
    async search(request) {
      if (typeof search !== "function") return [];
      const results = await search(request);
      return Array.isArray(results) ? results : [];
    },
  });
}
