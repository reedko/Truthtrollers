// src/utils/SmartLink.tsx

import React from "react";
import {
  Box,
  Link,
  Text,
  VStack,
  Icon,
  AspectRatio,
  useColorModeValue,
} from "@chakra-ui/react";
import {
  FaFilePdf,
  FaHeadphones,
  FaVideo,
  FaExternalLinkAlt,
} from "react-icons/fa";

export const getFileType = (url: string): string => {
  const cleanUrl = url.split("?")[0].toLowerCase();
  const match = cleanUrl.match(/\.[a-z0-9]+$/);
  return match ? match[0] : "";
};

interface SmartLinkProps {
  url: string;
}

export const SmartLink: React.FC<SmartLinkProps> = ({ url }) => {
  const ext = getFileType(url);
  const isAudio = [".mp3", ".wav", ".m4a", ".ogg", ".flac"].includes(ext);
  const isVideo = [".mp4", ".mov", ".webm", ".avi", ".mkv"].includes(ext);
  const isPDF = ext === ".pdf";

  const borderColor = useColorModeValue("gray.200", "gray.600");
  const hoverBg = useColorModeValue("gray.50", "gray.700");

  if (isPDF) {
    const viewerUrl = `https://docs.google.com/viewer?url=${encodeURIComponent(
      url
    )}`;
    return (
      <Box border="1px" borderColor={borderColor} p={3} rounded="md">
        <VStack spacing={2} align="start">
          <Icon as={FaFilePdf} boxSize={5} color="red.500" />
          <Link href={viewerUrl} isExternal fontWeight="bold">
            📄 View PDF
          </Link>
        </VStack>
      </Box>
    );
  }

  if (isAudio) {
    return (
      <Box border="1px" borderColor={borderColor} p={3} rounded="md">
        <VStack spacing={2} align="start">
          <Icon as={FaHeadphones} boxSize={5} color="blue.400" />
          <audio controls style={{ width: "100%" }}>
            <source src={url} type="audio/mpeg" />
            Your browser does not support the audio element.
          </audio>
          <Link href={url} isExternal>
            🎧 Open Audio
          </Link>
        </VStack>
      </Box>
    );
  }

  if (isVideo) {
    return (
      <Box border="1px" borderColor={borderColor} p={3} rounded="md">
        <VStack spacing={2} align="start">
          <Icon as={FaVideo} boxSize={5} color="purple.400" />
          <AspectRatio ratio={16 / 9} width="100%">
            <video controls>
              <source src={url} type="video/mp4" />
              Your browser does not support the video tag.
            </video>
          </AspectRatio>
          <Link href={url} isExternal>
            🎬 Open Video
          </Link>
        </VStack>
      </Box>
    );
  }

  return (
    <Box
      border="1px"
      borderColor={borderColor}
      p={3}
      rounded="md"
      _hover={{ bg: hoverBg }}
    >
      <VStack spacing={2} align="start">
        <Icon as={FaExternalLinkAlt} boxSize={5} color="gray.500" />
        <Link href={url} isExternal>
          🔗 View Link
        </Link>
      </VStack>
    </Box>
  );
};
