// src/components/LinkCard.tsx
import {
  Box,
  Text,
  Button,
  Image,
  Center,
  Progress,
  Menu,
  MenuButton,
  MenuList,
  MenuItem,
  HStack,
  Select,
  useDisclosure,
  useToast,
  Tooltip,
  Portal,
} from "@chakra-ui/react";
import { FiTrash2 } from "react-icons/fi";
import { useNavigate, useLocation } from "react-router-dom";
import { useRef, useState, memo, useEffect } from "react";
import { useTaskStore } from "../store/useTaskStore";
import { useAuthStore } from "../store/useAuthStore";
import AssignUserModal from "./modals/AssignUserModal";
import ReferenceModal from "./modals/ReferenceModal";
import { ContentLink } from "../../../shared/entities/types";
import { extractMeta } from "../utils/normalize";
import { uploadImage, fetchTask } from "../services/useDashboardAPI";
import { api } from "../services/api";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:5001";

interface LinkCardProps {
  link: ContentLink | ContentLink[] | null;
  useStore?: boolean;
  /** already existed in your code */
  compact?: boolean;
  /** hide middle meta block (image/authors/publishers/progress) */
  hideMeta?: boolean;
  onSelect?: (ContentLink: ContentLink) => void;
}

const LinkCard: React.FC<LinkCardProps> = ({
  link,
  useStore = true,
  compact = false,
  hideMeta = false,
  onSelect,
}) => {
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const [activeContentLink, setActiveContentLink] =
    useState<ContentLink | null>(Array.isArray(link) ? link[0] : link);
  const [imageKey, setImageKey] = useState(Date.now()); // Force image reload
  const [imageError, setImageError] = useState(false); // Track if image failed to load
  const [isCompleted, setIsCompleted] = useState(false); // Track completion status
  const cardRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [modalPosition, setModalPosition] = useState({ top: 0, left: 0 });

  const { setSelectedTask, selectedRedirect, lastWorkPage } = useTaskStore();
  const fetchAssignedUsers = useTaskStore((s) => s.fetchAssignedUsers);
  const fetchTaskForUser = useTaskStore((s) => s.fetchTasksForUser);
  const assignedUsers = useTaskStore((s) =>
    activeContentLink
      ? s.assignedUsers[activeContentLink.content_id]
      : undefined,
  );
  const user = useAuthStore((s) => s.user);

  // Debug: Log user role
  useEffect(() => {
    console.log("[LinkCard] Current user:", user);
    console.log("[LinkCard] User role:", user?.role);
  }, [user]);

  const {
    isOpen: isAssignOpen,
    onOpen: onAssignOpen,
    onClose: onAssignClose,
  } = useDisclosure();

  const {
    isOpen: isReferenceModalOpen,
    onOpen: onReferenceModalOpen,
    onClose: onReferenceModalClose,
  } = useDisclosure();

  useEffect(() => {
    if (Array.isArray(link)) setActiveContentLink(link[0]);
    else setActiveContentLink(link);
    setImageError(false); // Reset image error state when ContentLink changes
  }, [link]);

  // Note: Removed per-card API calls for assigned users and completion status
  // These should be batched at the page level to prevent performance issues
  // when rendering many cards simultaneously

  if (!activeContentLink) return null;

  const handleOpenModal = (openModal: () => void) => {
    if (cardRef.current) {
      const { top, left } = cardRef.current.getBoundingClientRect();
      setModalPosition({
        top: top - 70,
        left: left >= 740 ? left - 400 : left + 200,
      });
    }
    openModal();
  };

  const handleDelete = async () => {
    if (!user?.user_id) {
      toast({
        title: "Error",
        description: "You must be logged in to delete ContentLinks",
        status: "error",
        duration: 3000,
        isClosable: true,
      });
      return;
    }

    const handleDeleteContentLink = async () => {
      if (!user?.user_id) {
        toast({
          title: "Error",
          description: "You must be logged in to delete ContentLinks",
          status: "error",
          duration: 3000,
          isClosable: true,
        });
        return;
      }
    };

    const handleMarkComplete = async () => {
      if (!user?.user_id) {
        toast({
          title: "Error",
          description: "You must be logged in to mark ContentLinks complete",
          status: "error",
          duration: 3000,
          isClosable: true,
        });
        return;
      }
    };

    const handleMarkIncomplete = async () => {
      if (!user?.user_id) {
        toast({
          title: "Error",
          description: "You must be logged in to mark ContentLinks incomplete",
          status: "error",
          duration: 3000,
          isClosable: true,
        });
        return;
      }

      try {
        const response = await fetch(
          `${API_BASE_URL}/api/mark-ContentLink-incomplete`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              contentId: activeContentLink.content_id,
              userId: user.user_id,
            }),
          },
        );

        if (!response.ok) {
          throw new Error("Failed to mark ContentLink incomplete");
        }

        toast({
          title: "ContentLink marked incomplete",
          description: "ContentLink has been marked as not completed",
          status: "success",
          duration: 4000,
          isClosable: true,
        });

        setIsCompleted(false);

        // Optionally refresh the ContentLink list
        if (user.user_id) {
          fetchTaskForUser(user.user_id, false);
        }
      } catch (error: any) {
        toast({
          title: "Error marking ContentLink incomplete",
          description: error.message || "An error occurred",
          status: "error",
          duration: 3000,
          isClosable: true,
        });
      }
    };

    // Keep height predictable but not forcing width
    const cardHeight = hideMeta
      ? compact
        ? "130px"
        : "230px"
      : compact
        ? "340px"
        : "405px";

    return (
      // Root wrapper MUST be full-width to avoid stagger;
      // no margins here—let parent control spacing via gap
      <Box w="100%" maxW="unset" minW={0}>
        <Box
          ref={cardRef}
          className="mr-card mr-card-blue"
          overflow="hidden"
          p={compact && hideMeta ? 1 : 3}
          w="100%"
          maxW="unset"
          minW={0}
          h={cardHeight}
          display="flex"
          flexDirection="column"
          justifyContent="space-between"
        >
          <div className="mr-glow-bar mr-glow-bar-blue" />
          <div className="mr-scanlines" />

          {/* Title bar */}
          <Center>
            <Text
              className="mr-badge mr-badge-blue"
              fontSize={compact && hideMeta ? "7px" : "sm"}
              mb={compact && hideMeta ? 0 : 1}
              lineHeight={compact && hideMeta ? "1" : "normal"}
            >
              {activeContentLink?.content_type === "reference"
                ? "Source Details"
                : "Case Details"}
            </Text>
          </Center>

          {Array.isArray(link) && link.length > 1 ? (
            <Select
              size="md"
              value={activeContentLink.content_id}
              onChange={(e) => {
                const next = link.find(
                  (t) => t.content_id === Number(e.target.value),
                );
                if (next) {
                  setActiveContentLink(next);
                  onSelect?.(next);
                }
              }}
              mb={2}
              fontWeight="semibold"
              color="gray.800"
              bg="whiteAlpha.800"
              borderRadius="md"
            >
              {link.map((t) => (
                <option key={t.content_id} value={t.content_id}>
                  {t.content_name.slice(0, 30)}
                </option>
              ))}
            </Select>
          ) : (
            <Tooltip
              label={activeContentLink.content_name}
              placement="top"
              hasArrow
            >
              <Box
                mt={compact && hideMeta ? 0 : 2}
                bg="whiteAlpha.700"
                borderRadius="md"
                mb={compact && hideMeta ? 1 : 2}
                minH={compact && hideMeta ? "20px" : compact ? "40px" : "48px"}
                display="flex"
                alignItems="center"
                justifyContent="center"
                px={compact && hideMeta ? 1 : 2}
                cursor={
                  activeContentLink.media_source === "TextPad"
                    ? "pointer"
                    : "default"
                }
                onClick={() => {
                  if (activeContentLink.media_source === "TextPad") {
                    navigate(
                      `/textpad?contentId=${activeContentLink.content_id}`,
                    );
                  }
                }}
                _hover={
                  activeContentLink.media_source === "TextPad"
                    ? { bg: "whiteAlpha.800" }
                    : {}
                }
              >
                <Text
                  fontWeight="semibold"
                  color="gray.800"
                  noOfLines={1}
                  fontSize={compact && hideMeta ? "9px" : compact ? "sm" : "md"}
                  textAlign="center"
                  overflow="hidden"
                  textOverflow="ellipsis"
                  whiteSpace="nowrap"
                >
                  {activeContentLink.media_source === "TextPad" ? (
                    activeContentLink.content_name
                  ) : (
                    <a
                      href={activeContentLink.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {activeContentLink.content_name}
                    </a>
                  )}
                </Text>
              </Box>
            </Tooltip>
          )}

          {/* Tiny thumbnail when compact + hideMeta */}
          {compact && hideMeta && (
            <Box w="100%" h="60px" overflow="hidden" borderRadius="sm" mb={1}>
              {imageError ? (
                <Box
                  w="100%"
                  h="100%"
                  bg="linear-gradient(135deg, #667eea 0%, #764ba2 100%)"
                  display="flex"
                  alignItems="center"
                  justifyContent="center"
                >
                  <Text fontSize="2xl">📝</Text>
                </Box>
              ) : (
                <Image
                  src={`${API_BASE_URL}/api/image/content/${activeContentLink.content_id}?t=${imageKey}`}
                  alt="Thumbnail"
                  w="100%"
                  h="100%"
                  objectFit="cover"
                  onError={() => setImageError(true)}
                />
              )}
            </Box>
          )}

          {!hideMeta && (
            <Box flex="1" minH={0}>
              <Box
                as="button"
                onClick={() => {
                  if (activeContentLink.media_source === "TextPad") {
                    navigate(
                      `/textpad?contentId=${activeContentLink.content_id}`,
                    );
                  } else {
                    fileInputRef.current?.click();
                  }
                }}
                cursor="pointer"
                w="100%"
                h="150px"
                overflow="hidden"
                borderRadius="md"
                mb={2}
                border="2px solid transparent"
                _hover={{ border: "2px solid #3182ce" }}
                transition="border 0.2s"
              >
                {imageError ? (
                  <Box
                    w="100%"
                    h="100%"
                    bg="linear-gradient(135deg, #667eea 0%, #764ba2 100%)"
                    display="flex"
                    alignItems="center"
                    justifyContent="center"
                    flexDirection="column"
                    position="relative"
                    _hover={{
                      bg: "linear-gradient(135deg, #764ba2 0%, #667eea 100%)",
                    }}
                  >
                    <Text
                      fontSize="6xl"
                      mb={2}
                      filter="drop-shadow(0 2px 4px rgba(0,0,0,0.3))"
                    >
                      📝
                    </Text>
                    <Text
                      fontSize="sm"
                      color="white"
                      fontWeight="bold"
                      textShadow="0 1px 2px rgba(0,0,0,0.3)"
                    >
                      Text Document
                    </Text>
                    <Text
                      fontSize="xs"
                      color="whiteAlpha.800"
                      mt={1}
                      textShadow="0 1px 2px rgba(0,0,0,0.3)"
                    >
                      {activeContentLink.media_source === "TextPad"
                        ? "Click to view text"
                        : "Click to upload image"}
                    </Text>
                  </Box>
                ) : (
                  <Image
                    src={`${API_BASE_URL}/api/image/content/${activeContentLink.content_id}?t=${imageKey}`}
                    alt="Thumbnail"
                    w="100%"
                    h="100%"
                    objectFit="cover"
                    onError={() => setImageError(true)}
                  />
                )}
              </Box>

              <Progress
                value={
                  activeContentLink.progress === "Completed"
                    ? 100
                    : activeContentLink.progress === "Partially Complete"
                      ? 50
                      : 25
                }
                colorScheme={
                  activeContentLink.progress === "Completed"
                    ? "green"
                    : activeContentLink.progress === "Partially Complete"
                      ? "yellow"
                      : "red"
                }
                mt={2}
              />
            </Box>
          )}

          <HStack spacing={compact && hideMeta ? 1 : 2} w="100%">
            <Box flex="1" minW={0}></Box>

            <Box flex="1" minW={0}></Box>
          </HStack>
          {isAssignOpen && (
            <AssignUserModal
              isOpen={isAssignOpen}
              onClose={onAssignClose}
              taskId={activeContentLink.content_id}
              taskName={activeContentLink.content_name}
              position={modalPosition}
            />
          )}

          {isReferenceModalOpen && (
            <ReferenceModal
              isOpen={isReferenceModalOpen}
              onClose={onReferenceModalClose}
              taskId={activeContentLink.content_id}
            />
          )}
        </Box>
      </Box>
    );
  };
};

export default memo(LinkCard);
