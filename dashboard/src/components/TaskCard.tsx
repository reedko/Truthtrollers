// src/components/TaskCard.tsx
import {
  Box,
  Center,
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
} from "@chakra-ui/react";
import { BiChevronDown } from "react-icons/bi";
import { useNavigate } from "react-router-dom";
import { useRef, useState, memo, useEffect } from "react";
import { useTaskStore } from "../store/useTaskStore";
import AssignUserModal from "./modals/AssignUserModal";
import ReferenceModal from "./modals/ReferenceModal";
import { Task } from "../../../shared/entities/types";
import { extractMeta } from "../utils/normalize";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:5001";

interface TaskCardProps {
  task: Task | Task[] | null;
  useStore?: boolean;
  /** already existed in your code */
  compact?: boolean;
  /** NEW: hide middle meta block (image/authors/publishers/progress) */
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
  const [activeTask, setActiveTask] = useState<Task | null>(
    Array.isArray(task) ? task[0] : task
  );
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [modalPosition, setModalPosition] = useState({ top: 0, left: 0 });
  const { setSelectedTask, selectedRedirect } = useTaskStore();
  const fetchAssignedUsers = useTaskStore((s) => s.fetchAssignedUsers);

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
  }, [task]);

  if (!activeTask) return null;

  const { authors, publishers, users } = extractMeta(activeTask, useStore);

  const handleSelect = () => {
    setSelectedTask(activeTask);
    navigate(selectedRedirect || "/dashboard");
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

  return (
    <Center>
      <Box
        ref={cardRef}
        bg={isAssignOpen || isReferenceModalOpen ? "blue.200" : "stat2Gradient"}
        borderWidth="1px"
        borderRadius="lg"
        overflow="hidden"
        boxShadow="md"
        p={3}
        w="250px"
        // shorten height if meta hidden
        h={hideMeta ? "230px" : "405px"}
        display="flex"
        flexDirection="column"
        justifyContent="space-between"
        margin="10px"
      >
        <Center>
          <Text fontWeight="bold" fontSize="md">
            Content Details
          </Text>
        </Center>

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
                onSelect?.(next); // 🧠 Notify parent (UnifiedHeader)
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

        {/* META BLOCK — hide when hideMeta is true */}
        {!hideMeta && (
          <Box flex="1">
            <Box w="100%" h="150px" overflow="hidden" borderRadius="md" mb={2}>
              <Image
                src={`${API_BASE_URL}/${activeTask.thumbnail}`}
                alt="Thumbnail"
                w="100%"
                h="100%"
                objectFit="cover"
              />
            </Box>

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

        {/* ACTIONS */}
        <Center>
          <HStack>
            <Button colorScheme="blue" onClick={handleSelect}>
              Select
            </Button>

            <Menu>
              <MenuButton as={Button} colorScheme="teal">
                Actions
              </MenuButton>
              <MenuList>
                <Menu onOpen={handleAssignedUsersOpen}>
                  <MenuButton as={Button} rightIcon={<BiChevronDown />}>
                    Users
                  </MenuButton>
                  <MenuList>
                    {users.length > 0 ? (
                      users.map((user) => (
                        <MenuItem key={user.user_id}>{user.username}</MenuItem>
                      ))
                    ) : (
                      <MenuItem>No Users Assigned</MenuItem>
                    )}
                  </MenuList>
                </Menu>
                <MenuItem onClick={() => handleOpenModal(onAssignOpen)}>
                  Assign User
                </MenuItem>
                <MenuItem onClick={() => handleOpenModal(onReferenceModalOpen)}>
                  Manage References
                </MenuItem>
                <MenuItem onClick={handleDrillDown}>Drill Down</MenuItem>
              </MenuList>
            </Menu>
          </HStack>
        </Center>

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
    </Center>
  );
};

export default memo(TaskCard);
