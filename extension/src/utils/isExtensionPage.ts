// utils/isExtensionPage.ts
export function isExtensionPage(url: string | undefined | null): boolean {
  if (!url) return false;
  try {
    const { protocol } = new URL(url);
    return /^(chrome|moz|safari-web|ms-browser|edge)-extension:$/.test(
      protocol
    );
  } catch {
    return false;
  }
}
