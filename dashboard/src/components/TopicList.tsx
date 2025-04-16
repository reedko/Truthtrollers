import {
  Button,
  HStack,
  Heading,
  Image,
  List,
  ListItem,
  VStack,
} from "@chakra-ui/react";
import { memo, useEffect, useRef, useState } from "react";
import axios from "axios";
import { useTaskStore } from "../store/useTaskStore";
import { useShallow } from "zustand/react/shallow";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:5001";

interface Topic {
  topic_id: number;
  topic_name: string;
  thumbnail: string;
}

const TopicList: React.FC = () => {
  const selectedTopic = useTaskStore((state) => state.selectedTopic);
  const setSelectedTopic = useTaskStore(
    useShallow((state) => state.setSelectedTopic)
  );
  const [topics, setTopics] = useState<Topic[]>([]);

  const hasFetched = useRef(false); // Prevent multiple fetches

  useEffect(() => {
    if (hasFetched.current) return; // Skip if already fetched
    hasFetched.current = true;
    const fetchTopics = async () => {
      try {
        const response = await axios.get(`${API_BASE_URL}/api/topics`);
        setTopics(response.data);
      } catch (error) {
        console.error("Error fetching topics:", error);
      }
    };

    fetchTopics();
  }, []);

  return (
    <VStack align="stretch" spacing={2} width="100%" maxWidth="300px">
      <Heading size="md" marginBottom={2}>
        Topics
      </Heading>
      <List spacing={2}>
        <ListItem>
          <Button
            onClick={() => setSelectedTopic(undefined)}
            variant="outline"
            colorScheme="red"
          >
            All Topics
          </Button>
        </ListItem>
        {topics.map((topic) => (
          <ListItem key={topic.topic_id}>
            <HStack alignItems="start" spacing={2}>
              <Image
                src={`${API_BASE_URL}/${topic.thumbnail}`}
                alt={`${topic.topic_name} Thumbnail`}
                borderRadius="md"
                boxSize="40px"
                objectFit="cover"
                backgroundColor={"teal.50"}
              />
              <Button
                justifyContent="start"
                textAlign="left"
                whiteSpace="normal" // ✅ allow wrapping
                wordBreak="break-word" // ✅ break long words if needed
                fontWeight={
                  topic.topic_name === selectedTopic ? "bold" : "normal"
                }
                onClick={() => {
                  if (topic.topic_name !== selectedTopic) {
                    console.log("Clicked topic:", topic.topic_name);
                    setSelectedTopic(topic.topic_name);
                  }
                }}
                size="sm"
                fontSize="sm"
                variant="ghost"
                flex="1"
                minWidth="0"
                p={2}
                _hover={{ backgroundColor: "gray.400" }}
              >
                {topic.topic_name.toUpperCase()}
              </Button>
            </HStack>
          </ListItem>
        ))}
      </List>
    </VStack>
  );
};

export default memo(TopicList);
