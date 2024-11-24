const checkAndDownloadTopicIcon = async (
  generalTopic: string
): Promise<string | null> => {
  try {
    const response = await fetch(
      "http://localhost:5001/api/checkAndDownloadTopicIcon",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ generalTopic }),
      }
    );

    if (!response.ok) {
      throw new Error(
        `Failed to check/download topic icon: ${response.statusText}`
      );
    }

    const { thumbnail_url } = await response.json();
    return thumbnail_url; // Can be null if the topic already exists
  } catch (error) {
    console.error("Error in checkAndDownloadTopicIcon:", error);
    throw error;
  }
};

export default checkAndDownloadTopicIcon;
