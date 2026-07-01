// utils/getCitationScore.js

const getDomain = (url) => {
  try {
    const { hostname } = new URL(url);
    return hostname.replace(/^www\./, "");
  } catch (err) {
    console.warn("Invalid URL in getCitationScore:", url);
    return null;
  }
};

const getCitationScore = async (url, query) => {
  const domain = getDomain(url);
  if (!domain) return null;

  try {
    // 1. Lookup publisher by domain
    const publisherSql = `SELECT publisher_id FROM publishers WHERE domain = ?`;
    const [publisher] = await query(publisherSql, [domain]);
    if (!publisher) return null;

    // 2. Lookup rating for that publisher
    const ratingSql = `SELECT bias_score, veracity_score FROM publisher_ratings WHERE publisher_id = ?`;
    const [rating] = await query(ratingSql, [publisher.publisher_id]);
    if (!rating) return null;

    const { bias_score, veracity_score } = rating;

    const normalizedBias = 1 - Math.abs(bias_score ?? 0); // less bias = better
    const normalizedVeracity = veracity_score ?? 0; // veracity: 0-1 scale

    const finalScore =
      (normalizedBias * 0.4 + normalizedVeracity * 0.6) * 2 - 1;

    return parseFloat(finalScore.toFixed(2)); // final range: -1 to +1
  } catch (err) {
    console.error("❌ Error in getCitationScore:", err);
    return null;
  }
};

export default getCitationScore;
