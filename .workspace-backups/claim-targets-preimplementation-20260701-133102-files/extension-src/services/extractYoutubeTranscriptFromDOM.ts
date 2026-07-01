// services/extractYoutubeTranscriptFromDOM.ts
export async function getYoutubeTranscriptFromDOM(
  tabId: number
): Promise<string | null> {
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const segments = Array.from(
          document.querySelectorAll("ytd-transcript-segment-renderer")
        ) as HTMLElement[];
        return segments.map((s) => s.innerText.trim()).join(" ");
      },
    });
    return result || null;
  } catch (err) {
    console.warn("⚠️ Failed to extract YouTube transcript from DOM:", err);
    return null;
  }
}
