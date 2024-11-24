import axios from "axios";

const apiKey = process.env.REACT_APP_OPENAI_API_KEY;

export const getTopicsFromText = async (content: string) => {
  try {
    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4-turbo",
        messages: [
          { role: "system", content: "You are a content analysis assistant." },
          {
            role: "user",
            content: `Identify the most general topic for this text. Then, provide a list of more specific topics that fall under this general topic. Format your response as follows:
            General Topic: [general topic]
            Specific Topics:
            - [specific topic 1]
            - [specific topic 2]
            - [specific topic 3]

            Here is the text:${content}`,
          },
        ],
      },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.REACT_APP_OPENAI_API_KEY}`,
        },
      }
    );
    const rawContent = response.data.choices[0].message.content;

    // Extract General Topic
    const generalTopicMatch = rawContent.match(/General Topic:\s*(.+)/);
    const generalTopic = generalTopicMatch
      ? generalTopicMatch[1].trim().replace(/\*\*/g, "")
      : "Unknown";

    // Extract Specific Topics
    const specificTopics = rawContent
      .split("\n")
      .filter((line: string) => line.startsWith("-"))
      .map((line: string) =>
        line.replace("- ", "").trim().replace(/\*\*/g, "")
      );

    return { generalTopic, specificTopics }; // Replace detected_locations logic if needed
  } catch (error: any) {
    console.error("Error with OpenAI API:", error.response || error.message);
    throw new Error("Failed to extract topics from OpenAI API");
  }
};
