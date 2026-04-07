import React, { useEffect, useState } from "react";
import { Box, HStack, VStack, Image, Text, useColorModeValue } from "@chakra-ui/react";
import { useTaskStore } from "../store/useTaskStore";
import { fetchContentScores } from "../services/useDashboardAPI";
import VerimeterMeter from "./VerimeterMeter";
import { useVerimeterMode } from "../contexts/VerimeterModeContext";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "https://localhost:5001";

interface StickyTitleBarProps {
  /**
   * If true, the bar is always visible.
   * If false, it only appears when scrolling past a certain point.
   */
  alwaysVisible?: boolean;
}

const StickyTitleBar: React.FC<StickyTitleBarProps> = ({
  alwaysVisible = false,
}) => {
  const { mode, aiWeight } = useVerimeterMode();
  const selectedTask = useTaskStore((s) => s.selectedTask);
  const viewerId = useTaskStore((s) => s.viewingUserId);
  const [isVisible, setIsVisible] = useState(alwaysVisible);
  const [imageKey, setImageKey] = useState(Date.now());
  const [verimeterScore, setVerimeterScore] = useState<number | null>(null);

  useEffect(() => {
    if (alwaysVisible) {
      setIsVisible(true);
      return;
    }

    const handleScroll = () => {
      // Show title bar when scrolled past 200px
      if (window.scrollY > 200) {
        setIsVisible(true);
      } else {
        setIsVisible(false);
      }
    };

    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, [alwaysVisible]);

  // Update image when task changes
  useEffect(() => {
    setImageKey(Date.now());
  }, [selectedTask?.content_id]);

  // Fetch verimeter score
  useEffect(() => {
    if (selectedTask?.content_id) {
      fetchContentScores(selectedTask.content_id, viewerId, mode, aiWeight).then((scores) => {
        setVerimeterScore(scores?.verimeterScore ?? null);
      });
    }
  }, [selectedTask?.content_id, viewerId, mode, aiWeight]);

  if (!selectedTask) return null;

  return (
    <Box
      position="sticky"
      top={{ base: "60px", md: "50px" }}
      left={0}
      right={0}
      zIndex={999}
      bg="transparent"
      backdropFilter="blur(10px)"
      borderBottom="1px solid"
      borderColor={useColorModeValue("gray.200", "whiteAlpha.200")}
      transition="all 0.3s ease"
      opacity={isVisible ? 1 : 0}
      transform={isVisible ? "translateY(0)" : "translateY(-100%)"}
      pointerEvents={isVisible ? "auto" : "none"}
    >
      <VStack spacing={0} px={6} py={2} maxW="100%" overflow="hidden">
        {/* First Row: Image and Title */}
        <HStack spacing={4} justify="center" w="100%" mb={1}>
          <Image
            src={`${API_BASE_URL}/api/image/content/${selectedTask.content_id}?t=${imageKey}`}
            alt={selectedTask.content_name}
            boxSize="50px"
            borderRadius="lg"
            objectFit="cover"
            fallbackSrc={`${API_BASE_URL}/assets/images/content/content_id_default.png`}
            flexShrink={0}
            border="2px solid"
            borderColor={useColorModeValue("gray.300", "whiteAlpha.300")}
            boxShadow="0 4px 12px rgba(0, 0, 0, 0.2)"
          />
          <Text
            fontSize="lg"
            fontWeight="bold"
            color={useColorModeValue("gray.800", "gray.100")}
            noOfLines={1}
          >
            {selectedTask.content_name || "Untitled Case"}
          </Text>
        </HStack>

        {/* Second Row: Verimeter Gauge */}
        <VerimeterMeter score={verimeterScore} width="600px" showInterpretation={true} />
      </VStack>
    </Box>
  );
};

export default StickyTitleBar;
