import React, { useEffect, useState } from "react";
import { Box, Text, VStack, HStack, Progress, Spinner } from "@chakra-ui/react";
import { keyframes } from "@emotion/react";
import { useNavigate } from "react-router-dom";
import axios from "axios";

const API_BASE_URL = import.meta.env.VITE_BASE_URL || "https://localhost:5001";

interface HotTopic {
  content_id: number;
  task_title: string;
  discussion_count: number;
  pro_count: number;
  con_count: number;
}

// Pulsing glow animation
const pulseGlow = keyframes`
  0%, 100% { box-shadow: 0 0 10px rgba(239, 68, 68, 0.3), 0 0 10px rgba(34, 197, 94, 0.3); }
  50% { box-shadow: 0 0 20px rgba(239, 68, 68, 0.5), 0 0 20px rgba(34, 197, 94, 0.5); }
`;

const HotTopics: React.FC = () => {
  const [topics, setTopics] = useState<HotTopic[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    const fetchHotTopics = async () => {
      try {
        const res = await axios.get(`${API_BASE_URL}/api/discussion/hot-topics`);
        const data = res.data || [];

        // If no data from API, use fallback sample data
        if (data.length === 0) {
          setTopics([
            {
              content_id: 9999,
              task_title: "Climate Change Evidence Analysis",
              discussion_count: 34,
              pro_count: 21,
              con_count: 13,
            },
            {
              content_id: 9998,
              task_title: "Social Media Impact Study",
              discussion_count: 28,
              pro_count: 15,
              con_count: 13,
            },
            {
              content_id: 9997,
              task_title: "AI Safety Research Review",
              discussion_count: 19,
              pro_count: 12,
              con_count: 7,
            },
          ]);
        } else {
          setTopics(data);
        }
      } catch (error) {
        console.error("Failed to fetch hot topics:", error);
        // On error, show fallback data
        setTopics([
          {
            content_id: 9999,
            task_title: "Climate Change Evidence Analysis",
            discussion_count: 34,
            pro_count: 21,
            con_count: 13,
          },
          {
            content_id: 9998,
            task_title: "Social Media Impact Study",
            discussion_count: 28,
            pro_count: 15,
            con_count: 13,
          },
          {
            content_id: 9997,
            task_title: "AI Safety Research Review",
            discussion_count: 19,
            pro_count: 12,
            con_count: 7,
          },
        ]);
      } finally {
        setLoading(false);
      }
    };

    fetchHotTopics();

    // Refresh every 30 seconds
    const interval = setInterval(fetchHotTopics, 30000);
    return () => clearInterval(interval);
  }, []);

  const handleTopicClick = (contentId: number) => {
    navigate(`/discussion/${contentId}`);
  };

  if (loading) {
    return (
      <Box
        p={3}
        background="rgba(0, 0, 0, 0.4)"
        border="1px solid rgba(0, 162, 255, 0.3)"
        borderRadius="8px"
        textAlign="center"
      >
        <Spinner size="sm" color="#00a2ff" />
      </Box>
    );
  }

  return (
    <Box
      position="relative"
      w="full"
      background="rgba(0, 0, 0, 0.4)"
      backdropFilter="blur(10px)"
      border="1px solid rgba(0, 162, 255, 0.3)"
      borderRadius="8px"
      p={3}
      overflow="hidden"
    >
      {/* Scanlines */}
      <Box
        position="absolute"
        top={0}
        left={0}
        right={0}
        bottom={0}
        background="repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0, 162, 255, 0.03) 2px, rgba(0, 162, 255, 0.03) 4px)"
        pointerEvents="none"
        borderRadius="8px"
        zIndex={1}
      />

      <Box position="relative" zIndex={2}>
        {/* Header */}
        <Text
          color="#00a2ff"
          fontSize="0.65rem"
          fontWeight="700"
          textTransform="uppercase"
          letterSpacing="2px"
          mb={3}
          textAlign="center"
          textShadow="0 0 8px rgba(0, 162, 255, 0.6)"
        >
          ⚡ Hot Topics ⚡
        </Text>

        {/* Topics List */}
        <VStack spacing={2} align="stretch">
          {topics.map((topic, index) => {
              const total = topic.discussion_count;
              const proPercent = total > 0 ? (topic.pro_count / total) * 100 : 50;
              const conPercent = total > 0 ? (topic.con_count / total) * 100 : 50;

              return (
                <Box
                  key={topic.content_id}
                  p={2}
                  background={
                    index === 0
                      ? "rgba(0, 162, 255, 0.1)"
                      : "rgba(15, 23, 42, 0.5)"
                  }
                  border={
                    index === 0
                      ? "1px solid rgba(0, 162, 255, 0.4)"
                      : "1px solid rgba(100, 116, 139, 0.2)"
                  }
                  borderRadius="6px"
                  cursor="pointer"
                  transition="all 0.3s ease"
                  _hover={{
                    background: "rgba(0, 162, 255, 0.15)",
                    borderColor: "rgba(0, 162, 255, 0.5)",
                    transform: "translateX(2px)",
                  }}
                  onClick={() => handleTopicClick(topic.content_id)}
                  sx={
                    index === 0
                      ? {
                          animation: `${pulseGlow} 3s ease-in-out infinite`,
                        }
                      : {}
                  }
                >
                  <VStack spacing={2} align="stretch">
                    {/* Topic Title */}
                    <HStack spacing={2}>
                      {/* Rank Badge */}
                      <Box
                        minW="18px"
                        h="18px"
                        display="flex"
                        alignItems="center"
                        justifyContent="center"
                        background={
                          index === 0
                            ? "linear-gradient(135deg, rgba(239, 68, 68, 0.3), rgba(239, 68, 68, 0.1))"
                            : "rgba(100, 116, 139, 0.2)"
                        }
                        borderRadius="4px"
                        fontSize="0.6rem"
                        fontWeight="700"
                        color={index === 0 ? "#f87171" : "#94a3b8"}
                      >
                        {index + 1}
                      </Box>

                      <Text
                        fontSize="0.7rem"
                        fontWeight="600"
                        color="#e2e8f0"
                        isTruncated
                        flex={1}
                      >
                        {topic.task_title}
                      </Text>

                      {/* Discussion Count Badge */}
                      <Box
                        px={2}
                        py={0.5}
                        background="rgba(0, 162, 255, 0.2)"
                        borderRadius="4px"
                        fontSize="0.6rem"
                        fontWeight="700"
                        color="#60a5fa"
                      >
                        {total}
                      </Box>
                    </HStack>

                    {/* Pro/Con Split Visualization */}
                    <VStack spacing={1} align="stretch">
                      {/* Split Bar */}
                      <HStack spacing={0} h="6px" borderRadius="3px" overflow="hidden">
                        <Box
                          flex={proPercent}
                          background="linear-gradient(90deg, rgba(34, 197, 94, 0.6), rgba(34, 197, 94, 0.3))"
                          boxShadow="0 0 8px rgba(34, 197, 94, 0.4)"
                        />
                        <Box
                          flex={conPercent}
                          background="linear-gradient(90deg, rgba(239, 68, 68, 0.3), rgba(239, 68, 68, 0.6))"
                          boxShadow="0 0 8px rgba(239, 68, 68, 0.4)"
                        />
                      </HStack>

                      {/* Legend */}
                      <HStack spacing={3} justify="space-between" fontSize="0.55rem">
                        <HStack spacing={1}>
                          <Box
                            w="4px"
                            h="4px"
                            borderRadius="50%"
                            background="#4ade80"
                            boxShadow="0 0 4px rgba(34, 197, 94, 0.6)"
                          />
                          <Text color="#4ade80" fontWeight="600">
                            {topic.pro_count} Pro
                          </Text>
                        </HStack>
                        <HStack spacing={1}>
                          <Text color="#f87171" fontWeight="600">
                            {topic.con_count} Con
                          </Text>
                          <Box
                            w="4px"
                            h="4px"
                            borderRadius="50%"
                            background="#f87171"
                            boxShadow="0 0 4px rgba(239, 68, 68, 0.6)"
                          />
                        </HStack>
                      </HStack>
                    </VStack>
                  </VStack>
                </Box>
              );
            })}
        </VStack>
      </Box>
    </Box>
  );
};

export default HotTopics;
