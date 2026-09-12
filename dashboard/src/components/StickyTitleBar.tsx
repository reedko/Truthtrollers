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
  verimeterScore?: number | null;
}

const StickyTitleBar: React.FC<StickyTitleBarProps> = ({
  alwaysVisible = false,
  verimeterScore,
}) => {
  const { mode, aiWeight } = useVerimeterMode();
  const selectedTask = useTaskStore((s) => s.selectedTask);
  const viewerId = useTaskStore((s) => s.viewingUserId);
  const [isVisible, setIsVisible] = useState(alwaysVisible);
  const [imageKey, setImageKey] = useState(Date.now());
  const [liveVerimeterScore, setLiveVerimeterScore] = useState<number | null>(null);
  const borderColor = useColorModeValue("gray.200", "whiteAlpha.200");
  const imageBorderColor = useColorModeValue("gray.300", "whiteAlpha.300");
  const titleColor = useColorModeValue("gray.800", "gray.100");

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

  useEffect(() => {
    if (verimeterScore !== undefined || !selectedTask?.content_id) return;
    fetchContentScores(selectedTask.content_id, viewerId, mode, aiWeight).then((scores) => {
      setLiveVerimeterScore(scores?.verimeterScore ?? null);
    });
  }, [selectedTask?.content_id, viewerId, mode, aiWeight, verimeterScore]);

  if (!selectedTask) return null;

  return (
    <Box
      position="sticky"
      top={{ base: "60px", md: "50px" }}
      left={0}
      right={0}
      zIndex={999}
      bg="transparent"
      borderBottom="1px solid"
      borderColor={borderColor}
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
            borderColor={imageBorderColor}
            boxShadow="0 4px 12px rgba(0, 0, 0, 0.2)"
          />
          <Text
            fontSize="lg"
            fontWeight="bold"
            color={titleColor}
            noOfLines={1}
          >
            {selectedTask.content_name || "Untitled Case"}
          </Text>
        </HStack>

        {/* Second Row: Verimeter Gauge */}
        <VerimeterMeter score={verimeterScore ?? liveVerimeterScore} width="600px" showInterpretation={true} />
      </VStack>
    </Box>
  );
};

export default StickyTitleBar;
