export const extractVideoIdFromUrl = (url: string | null): string | null => {
  try {
    if (!url) return null;

    const youtubeRegex =
      /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/.*?[?&]v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
    const match = url.match(youtubeRegex);

    return match ? match[1] : null;
  } catch (error) {
    console.error("Error in extractVideoIdFromUrl:", error);
    return null;
  }
};
