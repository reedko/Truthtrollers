// src/components/TaskCard.tsx
import {
  Box,
  Text,
  Button,
  Image,
  Progress,
  Menu,
  MenuButton,
  MenuList,
  MenuItem,
  HStack,
  Select,
  useDisclosure,
  useToast,
  IconButton,
} from "@chakra-ui/react";
import { BiChevronDown } from "react-icons/bi";
import { FiTrash2 } from "react-icons/fi";
import { useNavigate } from "react-router-dom";
import { useRef, useState, memo, useEffect } from "react";
import { useTaskStore } from "../store/useTaskStore";
import { useAuthStore } from "../store/useAuthStore";
import AssignUserModal from "./modals/AssignUserModal";
import ReferenceModal from "./modals/ReferenceModal";
import { Task } from "../../../shared/entities/types";
import { extractMeta } from "../utils/normalize";
import { uploadImage, fetchTask } from "../services/useDashboardAPI";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:5001";

interface TaskCardProps {
  task: Task | Task[] | null;
  useStore?: boolean;
  /** already existed in your code */
  compact?: boolean;
  /** hide middle meta block (image/authors/publishers/progress) */
  hideMeta?: boolean;
  onSelect?: (task: Task) => void;
}

const TaskCard: React.FC<TaskCardProps> = ({
  task,
  useStore = true,
  compact = false,
  hideMeta = false,
  onSelect,
}) => {
  const navigate = useNavigate();
  const toast = useToast();
  const [activeTask, setActiveTask] = useState<Task | null>(
    Array.isArray(task) ? task[0] : task
  );
  const [imageKey, setImageKey] = useState(Date.now()); // Force image reload
  const [imageError, setImageError] = useState(false); // Track if image failed to load
  const cardRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [modalPosition, setModalPosition] = useState({ top: 0, left: 0 });

  const { setSelectedTask, selectedRedirect, lastWorkPage } = useTaskStore();
  const fetchAssignedUsers = useTaskStore((s) => s.fetchAssignedUsers);
  const fetchTasksForUser = useTaskStore((s) => s.fetchTasksForUser);
  const assignedUsers = useTaskStore((s) =>
    activeTask ? s.assignedUsers[activeTask.content_id] : undefined
  );
  const user = useAuthStore((s) => s.user);

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
    if (Array.isArray(task)) setActiveTask(task[0]);
    else setActiveTask(task);
    setImageError(false); // Reset image error state when task changes
  }, [task]);

  // Fetch assigned users when task changes
  useEffect(() => {
    if (activeTask && useStore) {
      fetchAssignedUsers(activeTask.content_id);
    }
  }, [activeTask, useStore, fetchAssignedUsers]);

  const handleUpload = async (file: File, contentId: number) => {
    try {
      console.log('📤 Uploading image for content:', contentId);
      const result = await uploadImage(contentId, file, "content");
      console.log('✅ Upload result:', result);

      if (result) {
        toast({
          title: "Image Uploaded",
          description: "Task thumbnail updated!",
          status: "success",
          duration: 3000,
          isClosable: true,
        });

        // Force re-fetch to get updated thumbnail
        console.log('🔄 Fetching updated task...');
        const updatedTask = await fetchTask(contentId);
        console.log('📦 Updated task:', updatedTask);

        if (updatedTask) {
          setActiveTask(updatedTask);
          setImageKey(Date.now()); // Force image reload by updating cache buster
          setImageError(false); // Reset error state to try loading the new image
        } else {
          console.error('❌ Failed to fetch updated task');
        }
      } else {
        console.error('❌ Upload failed - no result returned');
        toast({
          title: "Upload Failed",
          description: "Could not upload image. Please try again.",
          status: "error",
          duration: 3000,
          isClosable: true,
        });
      }
    } catch (error) {
      console.error('❌ Upload error:', error);
      toast({
        title: "Upload Error",
        description: error instanceof Error ? error.message : "An error occurred",
        status: "error",
        duration: 3000,
        isClosable: true,
      });
    }
  };

  if (!activeTask) return null;

  const { authors, publishers } = extractMeta(activeTask, useStore);

  const handleSelect = () => {
    setSelectedTask(activeTask);
    // Redirect to last work page, or selectedRedirect if set, or default to workspace
    const destination = selectedRedirect !== "/dashboard" ? selectedRedirect : lastWorkPage || "/workspace";
    navigate(destination);
  };

  const handleDrillDown = () => {
    navigate(`/tasks/${activeTask.content_id}`, {
      state: { task: activeTask },
    });
  };

  const handleAssignedUsersOpen = async () => {
    if (useStore) await fetchAssignedUsers(activeTask.content_id);
  };

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
        description: "You must be logged in to delete tasks",
        status: "error",
        duration: 3000,
        isClosable: true,
      });
      return;
    }

    if (!window.confirm(`Delete "${activeTask.content_name}"?`)) {
      return;
    }

    try {
      // Soft delete: set is_active = 0
      const response = await fetch(
        `${API_BASE_URL}/api/tasks/${activeTask.content_id}?userId=${user.user_id}`,
        {
          method: "DELETE",
        }
      );

      if (response.ok) {
        toast({
          title: "Task archived",
          description: "The task has been removed from your active list",
          status: "success",
          duration: 3000,
          isClosable: true,
        });

        // Refresh the task list (will show archived if that toggle is on)
        if (user.user_id) {
          // Fetch with current show archived state - the page will handle this
          fetchTasksForUser(user.user_id, false); // Default to not showing archived after delete
        }
      } else {
        const data = await response.json();
        throw new Error(data.error || "Failed to archive task");
      }
    } catch (error: any) {
      toast({
        title: "Archive failed",
        description: error.message || "An error occurred while archiving the task",
        status: "error",
        duration: 5000,
        isClosable: true,
      });
    }
  };

  // Keep height predictable but not forcing width
  const cardHeight = hideMeta
    ? compact
      ? "200px"
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
        p={3}
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
        <Box position="relative" mb={1}>
          <Text className="mr-badge mr-badge-blue" fontSize="md" textAlign="center">
            Content Details
          </Text>
        </Box>

        {Array.isArray(task) && task.length > 1 ? (
          <Select
            size="md"
            value={activeTask.content_id}
            onChange={(e) => {
              const next = task.find(
                (t) => t.content_id === Number(e.target.value)
              );
              if (next) {
                setActiveTask(next);
                onSelect?.(next);
              }
            }}
            mb={2}
            fontWeight="semibold"
            color="gray.800"
            bg="whiteAlpha.800"
            borderRadius="md"
          >
            {task.map((t) => (
              <option key={t.content_id} value={t.content_id}>
                {t.content_name.slice(0, 30)}
              </option>
            ))}
          </Select>
        ) : (
          <Text
            mt={2}
            fontWeight="semibold"
            bg="whiteAlpha.700"
            color="gray.800"
            borderRadius="md"
            noOfLines={2}
            fontSize={compact ? "sm" : "md"}
            textAlign="center"
            mb={2}
          >
            <a href={activeTask.url} target="_blank" rel="noopener noreferrer">
              {activeTask.content_name}
            </a>
          </Text>
        )}

        {!hideMeta && (
          <Box flex="1" minH={0}>
            <Box
              as="button"
              onClick={() => fileInputRef.current?.click()}
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
                  <Text fontSize="6xl" mb={2} filter="drop-shadow(0 2px 4px rgba(0,0,0,0.3))">
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
                    Click to upload image
                  </Text>
                </Box>
              ) : (
                <Image
                  src={`${API_BASE_URL}/api/image/content/${activeTask.content_id}?t=${imageKey}`}
                  alt="Thumbnail"
                  w="100%"
                  h="100%"
                  objectFit="cover"
                  onError={() => setImageError(true)}
                  loading="lazy"
                />
              )}
            </Box>

            <input
              type="file"
              accept="image/*"
              ref={fileInputRef}
              onChange={(e) => {
                if (e.target.files?.[0]) {
                  handleUpload(e.target.files[0], activeTask.content_id);
                }
              }}
              style={{ display: "none" }}
            />

            {authors.length > 0 && (
              <Text fontSize={compact ? "xs" : "sm"}>
                <strong>Author:</strong>{" "}
                {authors
                  .map(
                    (a) =>
                      `${a.author_first_name} ${a.author_last_name} ${
                        a.author_title || ""
                      }`
                  )
                  .join(", ")}
              </Text>
            )}

            {publishers.length > 0 && (
              <Text fontSize={compact ? "xs" : "sm"}>
                <strong>Publisher:</strong>{" "}
                {publishers.map((p) => p.publisher_name).join(", ")}
              </Text>
            )}

            <Progress
              value={
                activeTask.progress === "Completed"
                  ? 100
                  : activeTask.progress === "Partially Complete"
                  ? 50
                  : 25
              }
              colorScheme={
                activeTask.progress === "Completed"
                  ? "green"
                  : activeTask.progress === "Partially Complete"
                  ? "yellow"
                  : "red"
              }
              mt={2}
            />
          </Box>
        )}

        <HStack justify="center" spacing={2} w="100%">
          <Button className="mr-button" onClick={handleSelect} flex="1">
            Select
          </Button>

          <Menu onOpen={handleAssignedUsersOpen}>
            <MenuButton
              as={Button}
              className="mr-button"
              flex="1"
              rightIcon={<BiChevronDown />}
            >
              Actions
            </MenuButton>
            <MenuList>
              <MenuItem
                onClick={() => handleOpenModal(onAssignOpen)}
                fontWeight="bold"
                color="blue.500"
              >
                + Assign User
              </MenuItem>
              {assignedUsers && assignedUsers.length > 0 && (
                <>
                  {assignedUsers.map((u) => (
                    <MenuItem key={u.user_id} pl={6}>
                      👤 {u.username}
                    </MenuItem>
                  ))}
                </>
              )}
              {activeTask.media_source === "TextPad" && (
                <MenuItem
                  onClick={() => navigate(`/textpad?contentId=${activeTask.content_id}`)}
                  icon={<span>📝</span>}
                >
                  Open in TextPad
                </MenuItem>
              )}
              <MenuItem onClick={handleDelete} icon={<FiTrash2 />} color="red.400">
                Archive Task
              </MenuItem>
            </MenuList>
          </Menu>
        </HStack>

        {isAssignOpen && (
          <AssignUserModal
            isOpen={isAssignOpen}
            onClose={onAssignClose}
            taskId={activeTask.content_id}
            taskName={activeTask.content_name}
            position={modalPosition}
          />
        )}

        {isReferenceModalOpen && (
          <ReferenceModal
            isOpen={isReferenceModalOpen}
            onClose={onReferenceModalClose}
            taskId={activeTask.content_id}
          />
        )}
      </Box>
    </Box>
  );
};

export default memo(TaskCard);
