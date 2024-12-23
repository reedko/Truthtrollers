// src/services/diffbotService.js

import axios from "axios";

const DIFFBOT_TOKEN = process.env.REACT_APP_DIFFBOT_TOKEN;
const DIFFBOT_BASE_URL = process.env.REACT_APP_DIFFBOT_BASE_URL;

export const fetchArticleData = async (url: string) => {
  try {
    console.log(DIFFBOT_BASE_URL, "Db");
    const response = await axios.get(`${DIFFBOT_BASE_URL}/article`, {
      params: {
        token: DIFFBOT_TOKEN,
        url: url,
        fields:
          "title,text,author,keywords,images,links,meta,articleType,robots",
        // Add or remove fields based on your requirements
      },
    });
    return response.data.objects[0]; // Adjust based on response structure
  } catch (error) {
    console.error("Error fetching article data from Diffbot:", error);
    throw error;
  }
};
