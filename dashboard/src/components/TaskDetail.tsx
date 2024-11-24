import { useEffect, useState } from "react";
import { Box, Grid, Heading, Text, Link } from "@chakra-ui/react";
import TaskCard from "../components/TaskCard"; // TaskCard component
import axios from "axios"; // Import axios for scraping

import { useLocation } from "react-router-dom";

const TaskDetail = () => {
  const location = useLocation();
  const task = location.state?.task; // Retrieve task from location state

  if (!task) return <Text>Task not found</Text>; // Handle case where task is not provided
  const [articleContent, setArticleContent] = useState<string>(""); // State to hold scraped content
  const [loadingContent, setLoadingContent] = useState(true); // State for loading content
  const [contentError, setContentError] = useState<string | null>(null); // State for content error

  if (!task) return <Text>Task not found</Text>; // Handle case where task is not provided

  // Fetch the article content when the component mounts
  useEffect(() => {
    const fetchArticleContent = async () => {
      setLoadingContent(true); // Set loading state
      try {
        const response = await axios.get(
          `http://localhost:5001/api/scrapecontent?url=${encodeURIComponent(
            task.url
          )}`
        );
        setArticleContent(response.data); // Set the scraped content
      } catch (err) {
        console.error("Error fetching the URL:", err);
        setContentError("Failed to load content");
      } finally {
        setLoadingContent(false); // Reset loading state
      }
    };

    fetchArticleContent(); // Call the fetch function
  }, [task.url]); // Dependency on task.url to refetch if the URL changes

  // Loading and error handling for content
  if (loadingContent) return <Text>Loading content...</Text>;
  if (contentError) return <Text color="red.500">{contentError}</Text>;

  return (
    <>
      <Grid templateColumns={{ base: "1fr", md: "1fr 2fr" }} gap={4}>
        <Box>
          <Heading size="lg">{task.task_name}</Heading>
          <TaskCard task={task} onSelect={() => {}} isSelected={true} />{" "}
          {/* Display TaskCard */}
        </Box>
        <Box>
          <div dangerouslySetInnerHTML={{ __html: articleContent }} />{" "}
          {/* Render the HTML content directly */}
        </Box>
      </Grid>
      <Grid templateColumns="repeat(3, 1fr)" gap={4} mt={4}>
        {/* Placeholder for related publications */}
        {Array.from({ length: 3 }).map((_, index) => (
          <Box key={index} borderWidth="1px" borderRadius="lg" p={4}>
            <Heading size="md">Related Publication {index + 1}</Heading>
            <Text>
              <Link href={`https://example.com/${index}`} isExternal>
                Suggested Link {index + 1}
              </Link>
            </Text>
          </Box>
        ))}
      </Grid>
    </>
  );
};

export default TaskDetail;
