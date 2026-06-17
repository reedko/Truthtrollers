// src/components/TaskCard.tsx
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
  AlertDialog,
  AlertDialogBody,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogContent,
  AlertDialogOverlay,
  Checkbox,
  VStack,
} from "@chakra-ui/react";
import { FiTrash2 } from "react-icons/fi";
import { useNavigate, useLocation } from "react-router-dom";
import { useRef, useState, memo, useEffect } from "react";
import { useTaskStore } from "../store/useTaskStore";
import { useAuthStore } from "../store/useAuthStore";
import AssignUserModal from "./modals/AssignUserModal";
import ReferenceModal from "./modals/ReferenceModal";
import { Task } from "../../../shared/entities/types";
import { extractMeta } from "../utils/normalize";
import { uploadImage, fetchTask } from "../services/useDashboardAPI";
import { api } from "../services/api";
import SourceCrest from "./SourceCrest";
import SourceDetailModal from "./modals/SourceDetailModal";
import { normalizeSourceProfile } from "../utils/normalizeSourceProfile";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:5001";

const titlePanelSx = {
  position: "relative",
  overflow: "hidden",
  bg: "linear-gradient(135deg, rgba(15, 23, 42, 0.92), rgba(30, 41, 59, 0.82))",
  border: "1px solid rgba(0, 162, 255, 0.5)",
  color: "rgba(191, 235, 255, 0.96)",
  boxShadow:
    "0 8px 24px rgba(0,0,0,0.45), 0 0 24px rgba(0, 162, 255, 0.24), inset 0 1px 0 rgba(255,255,255,0.12)",
  _before: {
    content: '""',
    position: "absolute",
    left: 0,
    top: 0,
    width: "20px",
    height: "100%",
    background: "linear-gradient(90deg, rgba(0, 162, 255, 0.42) 0%, rgba(0, 162, 255, 0) 100%)",
    borderLeftRadius: "md",
    pointerEvents: "none",
  },
} as const;

interface TaskCardProps {
  task: Task | Task[] | null;
  useStore?: boolean;
  /** already existed in your code */
  compact?: boolean;
  /** hide middle meta block (image/authors/publishers/progress) */
  hideMeta?: boolean;
  onSelect?: (task: Task) => void;
  /** Role this content plays in the current context. Defaults to "case". */
  role?: "case" | "source";
}

const TaskCard: React.FC<TaskCardProps> = ({
  task,
  useStore = true,
  compact = false,
  hideMeta = false,
  onSelect,
  role = "case",
}) => {
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const [activeTask, setActiveTask] = useState<Task | null>(
    Array.isArray(task) ? task[0] : task,
  );
  const [sourceDetailOpen, setSourceDetailOpen] = useState(false);
  const [imageKey, setImageKey] = useState(Date.now()); // Force image reload
  const [imageError, setImageError] = useState(false); // Track if image failed to load
  const [isCompleted, setIsCompleted] = useState(false); // Track completion status
  const cardRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [modalPosition, setModalPosition] = useState({ top: 0, left: 0 });

  const { setSelectedTask, selectedRedirect, lastWorkPage } = useTaskStore();
  const fetchAssignedUsers = useTaskStore((s) => s.fetchAssignedUsers);
  const fetchTasksForUser = useTaskStore((s) => s.fetchTasksForUser);
  const assignedUsers = useTaskStore((s) =>
    activeTask ? s.assignedUsers[activeTask.content_id] : undefined,
  );
  const user = useAuthStore((s) => s.user);

  const {
    isOpen: isAssignOpen,
    onOpen: onAssignOpen,
    onClose: onAssignClose,
  } = useDisclosure();

  const {
    isOpen: isReferenceModalOpen,
    onClose: onReferenceModalClose,
  } = useDisclosure();

  useEffect(() => {
    if (Array.isArray(task)) setActiveTask(task[0]);
    else setActiveTask(task);
    setImageError(false); // Reset image error state when task changes
  }, [task]);

  // Note: Removed per-card API calls for assigned users and completion status
  // These should be batched at the page level to prevent performance issues
  // when rendering many cards simultaneously

  const handleUpload = async (file: File, contentId: number) => {
    try {
      const result = await uploadImage(contentId, file, "content");

      if (result) {
        toast({
          title: "Image Uploaded",
          description: "Task thumbnail updated!",
          status: "success",
          duration: 3000,
          isClosable: true,
        });

        // Force re-fetch to get updated thumbnail
        const updatedTask = await fetchTask(contentId);

        if (updatedTask) {
          setActiveTask(updatedTask);
          setImageKey(Date.now()); // Force image reload by updating cache buster
          setImageError(false); // Reset error state to try loading the new image
        } else {
        }
      } else {
        toast({
          title: "Upload Failed",
          description: "Could not upload image. Please try again.",
          status: "error",
          duration: 3000,
          isClosable: true,
        });
      }
    } catch (error) {
      toast({
        title: "Upload Error",
        description:
          error instanceof Error ? error.message : "An error occurred",
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
    const destination =
      selectedRedirect !== "/dashboard"
        ? selectedRedirect
        : lastWorkPage || "/workspace";
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
        },
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
        description:
          error.message || "An error occurred while archiving the task",
        status: "error",
        duration: 5000,
        isClosable: true,
      });
    }
  };

  const { isOpen: isDeleteOpen, onOpen: onDeleteOpen, onClose: onDeleteClose } = useDisclosure();
  const [deleteIncludeRefs, setDeleteIncludeRefs] = useState(false);
  const deleteConfirmRef = useRef<HTMLButtonElement>(null);

  const handleDeleteTask = () => {
    if (!user?.user_id) {
      toast({ title: "Error", description: "You must be logged in to delete tasks", status: "error", duration: 3000 });
      return;
    }
    onDeleteOpen();
  };

  const confirmDeleteTask = async () => {
    onDeleteClose();
    try {
      await api.delete(
        `/api/delete-content/${activeTask.content_id}?includeReferences=${deleteIncludeRefs}`,
      );

      toast({
        title: "Task Deleted",
        description: `Content ${activeTask.content_id} and all related data have been permanently deleted`,
        status: "success",
        duration: 4000,
        isClosable: true,
      });

      // Refresh task list first
      if (user?.user_id) {
        await fetchTasksForUser(user.user_id, false);
      }

      // Clear selected task
      setSelectedTask(null);

      // If already on tasks page, reload to refresh the list
      // Otherwise navigate to tasks page
      if (location.pathname === "/tasks") {
        window.location.reload();
      } else {
        navigate("/tasks");
      }

      // Navigate away if we're on a detail page for this task
      const selectedTask = useTaskStore.getState().selectedTask;
      if (selectedTask?.content_id === activeTask.content_id) {
        navigate("/");
      }
    } catch (error: any) {
      console.error("[DELETE TASK] Error:", error);
      const errorMessage =
        error.response?.data?.error || error.message || "An error occurred";
      toast({
        title: "Error deleting task",
        description: errorMessage,
        status: "error",
        duration: 5000,
        isClosable: true,
      });
    }
  };

  const handleMarkComplete = async () => {
    if (!user?.user_id) {
      toast({
        title: "Error",
        description: "You must be logged in to mark tasks complete",
        status: "error",
        duration: 3000,
        isClosable: true,
      });
      return;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/api/mark-task-complete`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contentId: activeTask.content_id,
          userId: user.user_id,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to mark task complete");
      }

      toast({
        title: "Task marked complete!",
        description:
          "The extension will now show this task when you visit the URL",
        status: "success",
        duration: 4000,
        isClosable: true,
      });

      setIsCompleted(true);

      // Optionally refresh the task list
      if (user.user_id) {
        fetchTasksForUser(user.user_id, false);
      }
    } catch (error: any) {
      toast({
        title: "Error marking task complete",
        description: error.message || "An error occurred",
        status: "error",
        duration: 3000,
        isClosable: true,
      });
    }
  };

  const handleMarkIncomplete = async () => {
    if (!user?.user_id) {
      toast({
        title: "Error",
        description: "You must be logged in to mark tasks incomplete",
        status: "error",
        duration: 3000,
        isClosable: true,
      });
      return;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/api/mark-task-incomplete`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contentId: activeTask.content_id,
          userId: user.user_id,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to mark task incomplete");
      }

      toast({
        title: "Task marked incomplete",
        description: "Task has been marked as not completed",
        status: "success",
        duration: 4000,
        isClosable: true,
      });

      setIsCompleted(false);

      // Optionally refresh the task list
      if (user.user_id) {
        fetchTasksForUser(user.user_id, false);
      }
    } catch (error: any) {
      toast({
        title: "Error marking task incomplete",
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

  const firstPub = publishers[0];

  return (
    <>
    {/* Root wrapper MUST be full-width to avoid stagger;
        no margins here—let parent control spacing via gap */}
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
            {role === "source" ? "Source Details" : "Case Details"}
          </Text>
        </Center>

        {Array.isArray(task) && task.length > 1 ? (
          <Select
            size="md"
            value={activeTask.content_id}
            onChange={(e) => {
              const next = task.find(
                (t) => t.content_id === Number(e.target.value),
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
          <Tooltip label={activeTask.content_name} placement="top" hasArrow>
            <Box
              mt={compact && hideMeta ? 0 : 2}
              borderRadius="md"
              mb={compact && hideMeta ? 1 : 2}
              minH={compact && hideMeta ? "20px" : compact ? "40px" : "52px"}
              h={compact && hideMeta ? "20px" : compact ? "40px" : "52px"}
              display="flex"
              alignItems="center"
              justifyContent="center"
              px={compact && hideMeta ? 1 : 2}
              cursor={
                activeTask.media_source === "TextPad" ? "pointer" : "default"
              }
              onClick={() => {
                if (activeTask.media_source === "TextPad") {
                  navigate(`/textpad?contentId=${activeTask.content_id}`);
                }
              }}
              _hover={
                activeTask.media_source === "TextPad"
                  ? { boxShadow: "0 0 22px rgba(0, 162, 255, 0.32)" }
                  : {}
              }
              sx={titlePanelSx}
            >
              <Text
                fontWeight="semibold"
                noOfLines={1}
                fontSize={compact && hideMeta ? "9px" : compact ? "sm" : "lg"}
                textAlign="center"
                overflow="hidden"
                textOverflow="ellipsis"
                whiteSpace="nowrap"
              >
                {activeTask.media_source === "TextPad" ? (
                  activeTask.content_name
                ) : (
                  <a
                    href={activeTask.url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {activeTask.content_name}
                  </a>
                )}
              </Text>
            </Box>
          </Tooltip>
        )}

        {/* Tiny thumbnail when compact + hideMeta */}
        {compact && hideMeta && (
          <Box
            w="100%"
            h="60px"
            overflow="hidden"
            borderRadius="sm"
            mb={1}
          >
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
                src={`${API_BASE_URL}/api/image/content/${activeTask.content_id}?t=${imageKey}`}
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
                if (activeTask.media_source === "TextPad") {
                  navigate(`/textpad?contentId=${activeTask.content_id}`);
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
              position="relative"
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
                    {activeTask.media_source === "TextPad"
                      ? "Click to view text"
                      : "Click to upload image"}
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
                />
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
                position="absolute"
                left={0}
                right={0}
                bottom={0}
                height="6px"
                borderRadius="0"
                bg="blackAlpha.500"
              />
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
              <HStack spacing={1} fontSize={compact ? "xs" : "sm"}>
                <Text fontWeight="bold">by:</Text>
                {authors.length === 1 ? (
                  <Text noOfLines={1}>
                    {authors[0].author_first_name} {authors[0].author_last_name}
                  </Text>
                ) : (
                  <Menu placement="bottom-start">
                    <MenuButton
                      as={Text}
                      cursor="pointer"
                      color="blue.400"
                      textDecoration="underline"
                      noOfLines={1}
                      _hover={{ color: "blue.300" }}
                    >
                      {authors[0].author_first_name}{" "}
                      {authors[0].author_last_name}
                      {authors.length > 1 && ` +${authors.length - 1}`}
                    </MenuButton>
                    <MenuList
                      bg="gray.800"
                      borderColor="blue.500"
                      maxH="200px"
                      overflowY="auto"
                    >
                      {authors.map((a, idx) => (
                        <MenuItem
                          key={idx}
                          bg="gray.800"
                          _hover={{ bg: "gray.700" }}
                        >
                          {a.author_first_name} {a.author_last_name}
                          {a.author_title && ` - ${a.author_title}`}
                        </MenuItem>
                      ))}
                    </MenuList>
                  </Menu>
                )}
              </HStack>
            )}

            {publishers.length > 0 && (
              <HStack spacing={1} fontSize={compact ? "xs" : "sm"}>
                <SourceCrest
                  publisherName={publishers[0].publisher_name}
                  sourceType={normalizeSourceProfile({ publisher_name: publishers[0].publisher_name }).sourceType}
                  reliability={normalizeSourceProfile({ publisher_name: publishers[0].publisher_name }).reliability}
                  admiraltyCode={publishers[0].admiralty_code ?? undefined}
                  size="sm"
                  onClick={e => { e?.stopPropagation(); setSourceDetailOpen(true); }}
                />
                {publishers.length === 1 ? (
                  <Text noOfLines={1}>{publishers[0].publisher_name}</Text>
                ) : (
                  <Menu placement="bottom-start">
                    <MenuButton
                      as={Text}
                      cursor="pointer"
                      color="blue.400"
                      textDecoration="underline"
                      noOfLines={1}
                      _hover={{ color: "blue.300" }}
                    >
                      {publishers[0].publisher_name}
                      {publishers.length > 1 && ` +${publishers.length - 1}`}
                    </MenuButton>
                    <MenuList
                      bg="gray.800"
                      borderColor="blue.500"
                      maxH="200px"
                      overflowY="auto"
                    >
                      {publishers.map((p, idx) => (
                        <MenuItem
                          key={idx}
                          bg="gray.800"
                          _hover={{ bg: "gray.700" }}
                        >
                          {p.publisher_name}
                        </MenuItem>
                      ))}
                    </MenuList>
                  </Menu>
                )}
              </HStack>
            )}
          </Box>
        )}

        <HStack spacing={compact && hideMeta ? 1 : 2} w="100%">
          <Box flex="1" minW={0}>
            <Button
              className="mr-button"
              onClick={handleSelect}
              w="100%"
              size={compact && hideMeta ? "xs" : "md"}
              fontSize={compact && hideMeta ? "8px" : "md"}
              h={compact && hideMeta ? "20px" : "auto"}
              px={compact && hideMeta ? 1 : undefined}
            >
              Select
            </Button>
          </Box>

          <Box flex="1" minW={0}>
            <Menu
              onOpen={handleAssignedUsersOpen}
              closeOnBlur={true}
              closeOnSelect={true}
              placement="bottom"
              isLazy
            >
              <MenuButton
                as={Button}
                className="mr-button"
                w="100%"
                size={compact && hideMeta ? "xs" : "md"}
                fontSize={compact && hideMeta ? "8px" : "md"}
                h={compact && hideMeta ? "20px" : "auto"}
                px={compact && hideMeta ? 1 : undefined}
              >
                <Text ml={compact && hideMeta ? 0 : -2}>Actions</Text>
              </MenuButton>
              <Portal>
                <MenuList zIndex={9999} minW="200px" fontSize={compact && hideMeta ? "xs" : "md"}>
                {isCompleted ? (
                  <MenuItem
                    onClick={handleMarkIncomplete}
                    fontWeight="bold"
                    color="orange.400"
                    icon={<span>↻</span>}
                  >
                    Mark Incomplete
                  </MenuItem>
                ) : (
                  <MenuItem
                    onClick={handleMarkComplete}
                    fontWeight="bold"
                    color="green.500"
                    icon={<span>✓</span>}
                  >
                    Mark Complete
                  </MenuItem>
                )}
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
                    onClick={() =>
                      navigate(`/textpad?contentId=${activeTask.content_id}`)
                    }
                    icon={<span>📝</span>}
                  >
                    Open in TextPad
                  </MenuItem>
                )}
                {user?.role === "super_admin" && (
                  <>
                    <MenuItem
                      onClick={() => navigate(`/source-quality/${activeTask.content_id}`)}
                      icon={<span>📊</span>}
                      color="blue.400"
                      fontWeight="bold"
                    >
                      Source Quality Analysis
                    </MenuItem>
                    <MenuItem
                      onClick={handleDeleteTask}
                      icon={<span>🗑️</span>}
                      color="red.600"
                      fontWeight="bold"
                    >
                      Delete Task (Permanent)
                    </MenuItem>
                  </>
                )}
                <MenuItem
                  onClick={handleDelete}
                  icon={<FiTrash2 />}
                  color="red.400"
                >
                  Archive Task
                </MenuItem>
              </MenuList>
              </Portal>
            </Menu>
          </Box>
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
    {firstPub && sourceDetailOpen && (
      <SourceDetailModal
        isOpen={sourceDetailOpen}
        onClose={() => setSourceDetailOpen(false)}
        publisherId={firstPub.publisher_id}
        publisherName={firstPub.publisher_name}
        contentId={activeTask?.content_id}
        sourceUrl={activeTask?.url ?? undefined}
        sourceType={normalizeSourceProfile({ publisher_name: firstPub.publisher_name }).sourceType}
        reliability={normalizeSourceProfile({ publisher_name: firstPub.publisher_name }).reliability}
      />
    )}

    <AlertDialog
      isOpen={isDeleteOpen}
      leastDestructiveRef={deleteConfirmRef}
      onClose={onDeleteClose}
    >
      <AlertDialogOverlay>
        <AlertDialogContent bg="gray.900" borderColor="red.600" borderWidth="1px">
          <AlertDialogHeader color="red.400" fontWeight="bold">
            ⚠️ Delete Task Permanently
          </AlertDialogHeader>
          <AlertDialogBody>
            <VStack align="start" spacing={3}>
              <Text color="gray.200">
                Delete <Text as="span" color="cyan.300" fontWeight="bold">"{activeTask?.content_name}"</Text> and all its claims, ratings, and scores?
              </Text>
              <Checkbox
                isChecked={deleteIncludeRefs}
                onChange={(e) => setDeleteIncludeRefs(e.target.checked)}
                colorScheme="red"
              >
                <Text color="orange.300" fontSize="sm">
                  Also delete all linked source/reference articles and their claims
                </Text>
              </Checkbox>
              <Text fontSize="xs" color="gray.500">
                {deleteIncludeRefs
                  ? "⚠️ This will delete the task AND every source article scraped for it."
                  : "Reference articles will remain but lose their link to this task."}
              </Text>
            </VStack>
          </AlertDialogBody>
          <AlertDialogFooter gap={2}>
            <Button ref={deleteConfirmRef} onClick={onDeleteClose} size="sm" variant="ghost">
              Cancel
            </Button>
            <Button colorScheme="red" onClick={confirmDeleteTask} size="sm">
              {deleteIncludeRefs ? "Delete Task + All References" : "Delete Task Only"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialogOverlay>
    </AlertDialog>
    </>
  );
};

export default memo(TaskCard);
