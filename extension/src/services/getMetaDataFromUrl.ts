import cheerio from "cheerio";
import axios from "axios";

export const extractMetadataFromWebPage = async (url: string) => {
  try {
    const { data } = await axios.get(url);
    const $ = cheerio.load(data);

    // Extract metadata
    const publisher =
      $('meta[property="og:site_name"]').attr("content") || null;
    const author = $('meta[name="author"]').attr("content") || null;

    // Parse JSON-LD
    const jsonLd = $('script[type="application/ld+json"]').html();
    let structuredData = null;
    if (jsonLd) {
      structuredData = JSON.parse(jsonLd);
    }

    const publisherName =
      structuredData?.publisher?.name || publisher || "Unknown Publisher";
    const authorName =
      structuredData?.author?.name || author || "Unknown Author";

    return { publisherName, authorName };
  } catch (err) {
    console.error("Error extracting metadata:", err);
    throw err;
  }
};
