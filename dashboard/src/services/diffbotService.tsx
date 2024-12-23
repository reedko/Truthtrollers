// src/services/diffbotService.js

import axios from "axios";
const DIFFBOT_TOKEN = process.env.REACT_APP_DIFFBOT_TOKEN;
const DIFFBOT_BASE_URL = process.env.REACT_APP_DIFFBOT_BASE_URL;
const BASE_URL = process.env.REACT_APP_BASE_URL; //"https://api.diffbot.com/v3";

export const fetchArticleData = async (url: string) => {
  try {
    const response = await axios.get(`${BASE_URL}/article`, {
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
