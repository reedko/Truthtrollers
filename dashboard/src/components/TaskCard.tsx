import { useNavigate } from "react-router-dom";
import {
  Box,
  Image,
  Text,
  Progress,
  Button,
  Menu,
  MenuButton,
  MenuList,
  MenuItem,
  Center,
  useDisclosure,
  Link,
  HStack,
} from "@chakra-ui/react";
import { BiChevronDown } from "react-icons/bi";
import AssignUserModal from "./modals/AssignUserModal";
import ReferenceModal from "./modals/ReferenceModal";
import { useTaskStore } from "../store/useTaskStore";
import { memo, useRef, useState } from "react";
import { Task, Author, Publisher, User } from "../../../shared/entities/types";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:5001";

interface TaskCardProps {
  task: Task | { content_id: number } | null;
  useStore?: boolean;
  compact?: boolean;
}

// 🔍 Helper: Pull authors/publishers/users from store or props
function ensureArray<T>(val: unknown): T[] {
  // JSON string case
  if (typeof val === "string") {
    try {
      const parsed = JSON.parse(val);
      if (Array.isArray(parsed)) return parsed;
    } catch (e) {
      console.warn("🧨 Failed to parse stringified array:", val);
      return [];
    }
  }

  if (Array.isArray(val)) return val;

  if (
    val &&
    typeof val === "object" &&
    typeof (val as any).length === "number" &&
    (val as any).length > 0 &&
    [...Array((val as any).length).keys()].every((i) => i in (val as any))
  ) {
    return Array.from(
      { length: (val as any).length },
      (_, i) => (val as any)[i]
    );
  }

  if (
    val &&
    typeof val === "object" &&
    Object.keys(val).every((k) => /^\d+$/.test(k))
  ) {
    return Object.values(val) as T[];
  }

  return [];
}

function extractMeta(
  task: Task | { content_id: number } | null,
  useStore: boolean
): {
  authors: Author[];
  publishers: Publisher[];
  users: User[];
} {
  if (!task || !("content_id" in task)) {
    return { authors: [], publishers: [], users: [] };
  }

  const contentId = task.content_id;

  if (useStore) {
    const state = useTaskStore.getState();
    return {
      authors: state.authors?.[contentId] || [],
      publishers: state.publishers?.[contentId] || [],
      users: state.assignedUsers?.[contentId] || [],
    };
  }

  const fullTask = task as Task;
  console.log(fullTask, "TTRRYRYRUEIWOQWP", fullTask.authors, "AUTHR");
  return {
    authors: ensureArray<Author>(fullTask.authors),
    publishers: ensureArray<Publisher>(fullTask.publishers),
    users: ensureArray<User>(fullTask.users),
  };
}

const TaskCard: React.FC<TaskCardProps> = ({
  task,
  useStore = true,
  compact = false,
}) => {
  const navigate = useNavigate();
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [modalPosition, setModalPosition] = useState({ top: 0, left: 0 });

  const redirectTo = useTaskStore((s) => s.selectedRedirect);
  const fetchAssignedUsers = useTaskStore((s) => s.fetchAssignedUsers);
  const { setSelectedTask } = useTaskStore();

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

  if (!task || !("content_id" in task)) return null;

  const { authors, publishers, users } = extractMeta(task, useStore);

  const handleSelect = () => {
    setSelectedTask(task as Task);
    navigate(redirectTo || "/dashboard");
  };

  const handleDrillDown = () => {
    navigate(`/tasks/${task.content_id}`, { state: { task } });
  };

  const handleAssignedUsersOpen = async () => {
    if (useStore) {
      await fetchAssignedUsers(task.content_id);
    }
  };

  const handleOpenModal = (openModal: () => void) => {
    if (cardRef.current) {
      const { top, left } = cardRef.current.getBoundingClientRect();
      const newTop = top - 70;
      const newLeft = left >= 740 ? left - 400 : left + 200;
      setModalPosition({ top: newTop, left: newLeft });
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
        h="405px"
        display="flex"
        flexDirection="column"
        justifyContent="space-between"
        margin="10px"
      >
        <Center>
          <Text fontWeight="bold" fontSize="md" mb={0}>
            Content Details
          </Text>
        </Center>

        <Text
          fontWeight="bold"
          mt={2}
          bg="whiteAlpha.700"
          color="gray.800"
          borderRadius="md"
          noOfLines={2}
          fontSize={compact ? "sm" : "md"}
          textAlign="center"
          marginBottom="4px"
        >
          <Link href={(task as Task).url} target="_blank">
            {(task as Task).content_name}
          </Link>
        </Text>

        <Box flex="1">
          <Box w="100%" h="150px" overflow="hidden" borderRadius="md" mb={2}>
            <Image
              src={`${API_BASE_URL}/${(task as Task).thumbnail}`}
              alt="Thumbnail"
              borderRadius="md"
              w="100%"
              h="100%"
              objectFit="cover"
              mx="auto"
            />
          </Box>

          {authors.length > 0 && (
            <Text fontSize={compact ? "xs" : "sm"} mt={1}>
              <strong>Author:</strong>{" "}
              {authors
                .map((a) => `${a.author_first_name} ${a.author_last_name}`)
                .join(", ")}
            </Text>
          )}

          {publishers.length > 0 && (
            <Text fontSize={compact ? "xs" : "sm"} mt={1}>
              <strong>Publisher:</strong>{" "}
              {publishers.map((p) => p.publisher_name).join(", ")}
            </Text>
          )}

          <Progress
            value={
              (task as Task).progress === "Completed"
                ? 100
                : (task as Task).progress === "Partially Complete"
                ? 50
                : 25
            }
            colorScheme={
              (task as Task).progress === "Completed"
                ? "green"
                : (task as Task).progress === "Partially Complete"
                ? "yellow"
                : "red"
            }
            mt={2}
          />
        </Box>

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
            taskId={task.content_id}
            taskName={(task as Task).content_name}
            position={modalPosition}
          />
        )}

        {isReferenceModalOpen && (
          <ReferenceModal
            isOpen={isReferenceModalOpen}
            onClose={onReferenceModalClose}
            taskId={task.content_id}
          />
        )}
      </Box>
    </Center>
  );
};

export default memo(TaskCard);
