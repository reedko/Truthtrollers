import React, { useEffect, useState, useRef } from "react";
import {
  Box,
  Text,
  VStack,
  HStack,
  Image,
  Collapse,
  Button,
  Spinner,
} from "@chakra-ui/react";
import { ChevronDownIcon, ChevronUpIcon } from "@chakra-ui/icons";
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

const CollapsibleTopics: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [loading, setLoading] = useState(true);
  const selectedTopic = useTaskStore((state) => state.selectedTopic);
  const setSelectedTopic = useTaskStore(
    useShallow((state) => state.setSelectedTopic)
  );

  const hasFetched = useRef(false);

  useEffect(() => {
    if (hasFetched.current) return;
    hasFetched.current = true;

    const fetchTopics = async () => {
      try {
        const response = await axios.get(`${API_BASE_URL}/api/topics`);
        console.log("CollapsibleTopics - Fetched topics:", response.data);
        console.log("CollapsibleTopics - API_BASE_URL:", API_BASE_URL);
        if (response.data.length > 0) {
          console.log("CollapsibleTopics - First topic thumbnail:", response.data[0].thumbnail);
        }
        setTopics(response.data);
      } catch (error) {
        console.error("Error fetching topics:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchTopics();
  }, []);

  const handleTopicClick = (topicName?: string) => {
    setSelectedTopic(topicName);
  };

  if (loading) {
    return (
      <Box
        p={3}
        background="rgba(0, 0, 0, 0.4)"
        border="1px solid rgba(139, 92, 246, 0.3)"
        borderRadius="8px"
        textAlign="center"
      >
        <Spinner size="sm" color="#8b5cf6" />
      </Box>
    );
  }

  return (
    <Box
      position="relative"
      w="full"
      background="rgba(0, 0, 0, 0.4)"
      backdropFilter="blur(10px)"
      border="1px solid rgba(139, 92, 246, 0.3)"
      borderRadius="8px"
      overflow="hidden"
    >
      {/* Scanlines */}
      <Box
        position="absolute"
        top={0}
        left={0}
        right={0}
        bottom={0}
        background="repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(139, 92, 246, 0.03) 2px, rgba(139, 92, 246, 0.03) 4px)"
        pointerEvents="none"
        borderRadius="8px"
        zIndex={1}
      />

      <Box position="relative" zIndex={2}>
        {/* Header Button */}
        <Button
          w="full"
          background="transparent"
          border="none"
          p={3}
          onClick={() => setIsOpen(!isOpen)}
          _hover={{
            background: "rgba(139, 92, 246, 0.1)",
          }}
          _active={{
            background: "rgba(139, 92, 246, 0.15)",
          }}
          display="flex"
          justifyContent="space-between"
          alignItems="center"
        >
          <Text
            color="#8b5cf6"
            fontSize="0.65rem"
            fontWeight="700"
            textTransform="uppercase"
            letterSpacing="2px"
            textShadow="0 0 8px rgba(139, 92, 246, 0.6)"
          >
            📚 Topics
          </Text>
          {isOpen ? (
            <ChevronUpIcon color="#8b5cf6" boxSize={5} />
          ) : (
            <ChevronDownIcon color="#8b5cf6" boxSize={5} />
          )}
        </Button>

        {/* Collapsible Content */}
        <Collapse in={isOpen} animateOpacity>
          <Box px={3} pb={3} maxH="300px" overflowY="auto">
            <VStack spacing={2} align="stretch">
              {/* All Topics Button */}
              <Box
                p={2}
                background={
                  !selectedTopic
                    ? "rgba(139, 92, 246, 0.2)"
                    : "rgba(15, 23, 42, 0.3)"
                }
                border={
                  !selectedTopic
                    ? "1px solid rgba(139, 92, 246, 0.4)"
                    : "1px solid rgba(100, 116, 139, 0.2)"
                }
                borderRadius="6px"
                cursor="pointer"
                transition="all 0.3s ease"
                _hover={{
                  background: "rgba(139, 92, 246, 0.15)",
                  borderColor: "rgba(139, 92, 246, 0.5)",
                  transform: "translateX(2px)",
                }}
                onClick={() => handleTopicClick(undefined)}
              >
                <Text
                  fontSize="0.7rem"
                  fontWeight={!selectedTopic ? "700" : "600"}
                  color={!selectedTopic ? "#a78bfa" : "#e2e8f0"}
                >
                  All Topics
                </Text>
              </Box>

              {/* Topic Items */}
              {topics.map((topic) => (
                <Box
                  key={topic.topic_id}
                  p={2}
                  background={
                    topic.topic_name === selectedTopic
                      ? "rgba(139, 92, 246, 0.2)"
                      : "rgba(15, 23, 42, 0.3)"
                  }
                  border={
                    topic.topic_name === selectedTopic
                      ? "1px solid rgba(139, 92, 246, 0.4)"
                      : "1px solid rgba(100, 116, 139, 0.2)"
                  }
                  borderRadius="6px"
                  cursor="pointer"
                  transition="all 0.3s ease"
                  _hover={{
                    background: "rgba(139, 92, 246, 0.15)",
                    borderColor: "rgba(139, 92, 246, 0.5)",
                    transform: "translateX(2px)",
                  }}
                  onClick={() => handleTopicClick(topic.topic_name)}
                >
                  <HStack spacing={2}>
                    {topic.thumbnail ? (
                      <Image
                        src={`${API_BASE_URL}/${topic.thumbnail}`}
                        alt={`${topic.topic_name} Thumbnail`}
                        borderRadius="4px"
                        boxSize="30px"
                        objectFit="cover"
                        fallback={
                          <Box
                            boxSize="30px"
                            borderRadius="4px"
                            background="rgba(139, 92, 246, 0.2)"
                          />
                        }
                      />
                    ) : (
                      <Box
                        boxSize="30px"
                        borderRadius="4px"
                        background="rgba(139, 92, 246, 0.2)"
                      />
                    )}
                    <Text
                      fontSize="0.7rem"
                      fontWeight={
                        topic.topic_name === selectedTopic ? "700" : "600"
                      }
                      color={
                        topic.topic_name === selectedTopic
                          ? "#a78bfa"
                          : "#e2e8f0"
                      }
                      flex={1}
                      noOfLines={2}
                    >
                      {topic.topic_name}
                    </Text>
                  </HStack>
                </Box>
              ))}
            </VStack>
          </Box>
        </Collapse>
      </Box>
    </Box>
  );
};

export default CollapsibleTopics;
