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
} from "@chakra-ui/react";
import { BiChevronDown } from "react-icons/bi";
import AssignUserModal from "./AssignUserModal";
import ReferenceModal from "./ReferenceModal";
import { useTaskStore } from "../store/useTaskStore";
import { memo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { addReferenceToTask } from "../services/useDashboardAPI";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:5001";

const TaskCard: React.FC<{ task: any }> = ({ task }) => {
  const author = useTaskStore((state) => state.authors[task.content_id] || []);
  const publisher = useTaskStore(
    (state) => state.publishers[task.content_id] || []
  );
  const navigate = useNavigate();
  const fetchAssignedUsers = useTaskStore((state) => state.fetchAssignedUsers);
  const cardRef = useRef<HTMLDivElement | null>(null);

  const [modalPosition, setModalPosition] = useState({ top: 0, left: 0 });

  const assignedUsers = useTaskStore(
    useShallow((state) => state.assignedUsers[task.content_id] || [])
  );
  const addReference = useTaskStore((state) => state.addReferenceToTask); // ✅ Get function from store

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

  const handleDrillDown = () => {
    navigate(`/tasks/${task.content_id}`, { state: { task } });
  };

  const handleAssignedUsersOpen = async () => {
    try {
      console.log(`Fetching assigned users for task ${task.content_id}`);
      await fetchAssignedUsers(task.content_id);
    } catch (err) {
      console.error("Error fetching assigned users:", err);
    }
  };

  const handleOpenModal = (openModal: () => void) => {
    if (cardRef.current) {
      const { top, left, height } = cardRef.current.getBoundingClientRect();
      let newTop = top - 70;
      let newLeft = left >= 740 ? left - 400 : left + 200;

      setModalPosition({ top: newTop, left: newLeft });
      console.log("Modal Position:", modalPosition);
    }

    openModal();
  };

  return (
    <Center>
      <Box
        ref={cardRef}
        bg={isAssignOpen || isReferenceModalOpen ? "blue.200" : "teal"}
        borderWidth="1px"
        borderRadius="lg"
        overflow="hidden"
        boxShadow="md"
        p={4}
        width="250px"
        margin="10px"
      >
        {/* Thumbnail */}
        <Image
          src={`${API_BASE_URL}/${task.thumbnail}`}
          alt="Thumbnail"
          borderRadius="md"
          boxSize="200px"
          objectFit="cover"
        />

        {/* Task Name */}
        <Text fontWeight="bold" mt={2} noOfLines={2}>
          <Link href={task.url} target="_blank">
            {task.content_name}
          </Link>
        </Text>

        {/* Author Information */}
        {author.length > 0 && (
          <Text fontSize="sm" mt={1}>
            <strong>Author:</strong>{" "}
            {author
              .map((a) => `${a.author_first_name} ${a.author_last_name}`)
              .join(", ")}
          </Text>
        )}

        {/* Publisher Information */}
        {publisher.length > 0 && (
          <Text fontSize="sm" mt={1}>
            <strong>Publisher:</strong>{" "}
            {publisher.map((p) => p.publisher_name).join(", ")}
          </Text>
        )}

        {/* Progress Bar */}
        <Progress
          value={
            task.progress === "Completed"
              ? 100
              : task.progress === "Partially Complete"
              ? 50
              : 25
          }
          colorScheme={
            task.progress === "Completed"
              ? "green"
              : task.progress === "Partially Complete"
              ? "yellow"
              : "red"
          }
          mt={2}
        />

        {/* Assigned Users Dropdown */}
        <Menu onOpen={handleAssignedUsersOpen}>
          <MenuButton as={Button} rightIcon={<BiChevronDown />}>
            Users
          </MenuButton>
          <MenuList>
            {assignedUsers.length > 0 ? (
              assignedUsers.map((user) => (
                <MenuItem key={user.user_id}>{user.username}</MenuItem>
              ))
            ) : (
              <MenuItem>No Users Assigned</MenuItem>
            )}
          </MenuList>
        </Menu>

        {/* Actions Menu */}
        <Menu>
          <MenuButton as={Button} colorScheme="teal">
            Actions
          </MenuButton>
          <MenuList>
            <MenuItem onClick={() => handleOpenModal(onAssignOpen)}>
              Assign User
            </MenuItem>
            <MenuItem onClick={() => handleOpenModal(onReferenceModalOpen)}>
              Manage References
            </MenuItem>
            <MenuItem onClick={handleDrillDown}>Drill Down</MenuItem>
          </MenuList>
        </Menu>

        {/* Assign User Modal */}
        {isAssignOpen && (
          <AssignUserModal
            isOpen={isAssignOpen}
            onClose={onAssignClose}
            taskId={task.content_id}
            taskName={task.content_name}
            position={modalPosition}
          />
        )}

        {/* ✅ Reference Modal (Replaces SourceListModal) */}
        {isReferenceModalOpen && (
          <ReferenceModal
            isOpen={isReferenceModalOpen}
            onClose={onReferenceModalClose}
            taskId={task.content_id} // ✅ Keep this, since we need to know the task
          />
        )}
      </Box>
    </Center>
  );
};

export default memo(TaskCard);
