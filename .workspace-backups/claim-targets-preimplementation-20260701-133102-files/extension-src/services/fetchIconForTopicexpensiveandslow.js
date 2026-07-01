const dotenv = require("dotenv");
dotenv.config();
const OAuth = require("oauth");

const KEY = process.env.REACT_APP_NOUNPROJECT_API_KEY || "";
const SECRET = process.env.REACT_APP_NOUNPROJECT_SECRET_KEY || "";

const oauth = new OAuth.OAuth(
  "https://api.thenounproject.com",
  "https://api.thenounproject.com",
  KEY,
  SECRET,
  "1.0",
  null,
  "HMAC-SHA1"
);

const fetchIconForTopic = async (query) => {
  let queryUrl = `https://api.thenounproject.com/v2/icon?query=${encodeURIComponent(
    query
  )}&limit_to_public_domain=yes&thumbnail_size=84&limit=1`;

  console.log(queryUrl, ":fetchicon");

  try {
    const iconUrl = await fetchIcon(queryUrl);

    if (iconUrl) {
      return iconUrl;
    }

    // 🛑 If the first request fails, try only the first word
    const firstWord = query.split(" ")[0];
    if (firstWord !== query) {
      // Only retry if it's different
      console.log(`🔄 Retrying with first word: ${firstWord}`);
      const fallbackUrl = `https://api.thenounproject.com/v2/icon?query=${encodeURIComponent(
        firstWord
      )}&limit_to_public_domain=yes&thumbnail_size=84&limit=1`;
      return await fetchIcon(fallbackUrl);
    }

    return null;
  } catch (error) {
    console.error("Error fetching from Noun Project API:", error);
    return null;
  }
};

// ✅ Helper function to make OAuth request
const fetchIcon = (queryUrl) => {
  return new Promise((resolve, reject) => {
    oauth.get(
      queryUrl,
      "", // Access token (empty string here)
      "", // Access token secret (empty string here)
      (e, data) => {
        if (e) {
          console.error("Error fetching from Noun Project API:", e);
          reject(e);
          return;
        }

        try {
          const parsedData = JSON.parse(data ? data.toString() : "");
          const icons = parsedData?.icons;

          if (icons && icons.length > 0) {
            resolve(icons[0].thumbnail_url || null);
          } else {
            resolve(null);
          }
        } catch (error) {
          console.error("Error parsing API response:", error);
          reject(error);
        }
      }
    );
  });
};

module.exports = fetchIconForTopic;
