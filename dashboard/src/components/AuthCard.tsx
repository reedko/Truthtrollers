// src/components/AuthCard.tsx
import {
  Box,
  Image,
  Text,
  Tabs,
  TabList,
  TabPanels,
  Tab,
  TabPanel,
  Menu,
  MenuButton,
  MenuList,
  MenuItem,
  Button,
  useDisclosure,
  Center,
  Input,
  useToast,
  VStack,
  HStack,
  Badge,
  Flex,
  Select,
  Alert,
  AlertIcon,
  AlertDescription,
} from "@chakra-ui/react";
import { BiChevronDown } from "react-icons/bi";
import { Author, AuthorRating } from "../../../shared/entities/types";
import { useRef, useState, useEffect } from "react";
import AuthBioModal from "./modals/AuthBioModal";
import AuthRatingModal from "./modals/AuthRatingModal";
import ResponsiveOverlay from "./overlays/ResponsiveOverlay";
import {
  uploadImage,
  fetchAuthorRatings,
  updateAuthorBio,
  fetchAuthor,
  addAuthorsToContent,
  removeAuthorFromContent,
  fetchAuthors,
} from "../services/useDashboardAPI";

interface AuthCardProps {
  authors: Author[];
  compact?: boolean;
  contentId?: number;
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;
const AuthCard: React.FC<AuthCardProps> = ({ authors, compact = false, contentId }) => {
  const {
    isOpen: isBioOpen,
    onOpen: onBioOpen,
    onClose: onBioClose,
  } = useDisclosure();
  const {
    isOpen: isRatingOpen,
    onOpen: onRatingOpen,
    onClose: onRatingClose,
  } = useDisclosure();
  const {
    isOpen: isAddAuthorOpen,
    onOpen: onAddAuthorOpen,
    onClose: onAddAuthorClose,
  } = useDisclosure();
  const [activeAuthor, setActiveAuthor] = useState<Author | null>(authors[0]);
  const [allRatings, setAllRatings] = useState<{
    [authorId: number]: AuthorRating[];
  }>({});
  const [newAuthorName, setNewAuthorName] = useState("");
  const toast = useToast();
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [authorList, setAuthorList] = useState<Author[]>(authors);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (authors.length > 0) {
      setAuthorList(authors);
      setActiveAuthor(authors[0]);
    }
  }, [authors]);

  useEffect(() => {
    const loadAllRatings = async () => {
      const map: { [authorId: number]: AuthorRating[] } = {};
      for (const author of authors) {
        const ratings = await fetchAuthorRatings(author.author_id);
        map[author.author_id] = ratings;
      }
      setAllRatings(map);
    };
    if (authors.length) loadAllRatings();
  }, [authors]);

  const handleRatingsUpdate = (authorId: number, updated: AuthorRating[]) => {
    setAllRatings((prev) => ({ ...prev, [authorId]: updated }));
  };

  const handleUpload = async (file: File, authorId: number) => {
    const result = await uploadImage(authorId, file, "authors");
    if (result) {
      toast({
        title: "Image Uploaded",
        description: "Author profile image updated!",
        status: "success",
        duration: 3000,
        isClosable: true,
      });
      const updatedAuthor = await fetchAuthor(authorId);
      if (updatedAuthor) {
        setAuthorList((prev) =>
          prev.map((a) => (a.author_id === authorId ? updatedAuthor : a))
        );
        setActiveAuthor(updatedAuthor);
      }
    }
  };

  const handleAddAuthor = async () => {
    if (!contentId || !newAuthorName.trim()) {
      toast({
        title: "Error",
        description: "Please enter an author name",
        status: "error",
        duration: 3000,
        isClosable: true,
      });
      return;
    }

    const success = await addAuthorsToContent(contentId, [
      { name: newAuthorName.trim() },
    ]);

    if (success) {
      toast({
        title: "Author Added",
        description: "Author has been added to content",
        status: "success",
        duration: 3000,
        isClosable: true,
      });

      // Refresh author list
      const updatedAuthors = await fetchAuthors(contentId);
      setAuthorList(updatedAuthors);
      if (updatedAuthors.length > 0) {
        setActiveAuthor(updatedAuthors[updatedAuthors.length - 1]);
      }

      setNewAuthorName("");
      onAddAuthorClose();
    } else {
      toast({
        title: "Error",
        description: "Failed to add author",
        status: "error",
        duration: 3000,
        isClosable: true,
      });
    }
  };

  const handleRemoveAuthor = async () => {
    if (!contentId || !activeAuthor) return;

    const success = await removeAuthorFromContent(
      contentId,
      activeAuthor.author_id
    );

    if (success) {
      toast({
        title: "Author Removed",
        description: "Author has been removed from content",
        status: "success",
        duration: 3000,
        isClosable: true,
      });

      // Refresh author list
      const updatedAuthors = await fetchAuthors(contentId);
      setAuthorList(updatedAuthors);
      if (updatedAuthors.length > 0) {
        setActiveAuthor(updatedAuthors[0]);
      } else {
        setActiveAuthor(null);
      }
    } else {
      toast({
        title: "Error",
        description: "Failed to remove author",
        status: "error",
        duration: 3000,
        isClosable: true,
      });
    }
  };

  const getBiasEmoji = (score: number) =>
    score <= -5 || score >= 5 ? "🔴" : "🟢";
  const getVeracityEmoji = (score: number) =>
    score > 5 ? "🟢" : score < 0 ? "🔴" : "⚪";
  const currentRatings = activeAuthor
    ? allRatings[activeAuthor.author_id] || []
    : [];

  const avgScore = (key: keyof AuthorRating) => {
    if (!currentRatings.length) return "-";
    const values = currentRatings.map((r) => r[key] as number);
    const avg = values.reduce((acc, val) => acc + val, 0) / values.length;
    return avg.toFixed(1);
  };

  return (
    <Center>
      <Box
        ref={cardRef}
        className="mr-card mr-card-purple"
        p={4}
        w="100%"
        height="405px"
        display="flex"
        flexDirection="column"
        justifyContent="space-between"
      >
        <div className="mr-glow-bar mr-glow-bar-purple" />
        <div className="mr-scanlines" />
        <Box>
          <Center>
            <Text className="mr-badge mr-badge-purple" fontSize="md" mb={2}>
              Author Details
            </Text>
          </Center>
          {authors.length > 1 ? (
            <Select
              size="sm"
              value={activeAuthor?.author_id}
              onChange={(e) => {
                const found = authors.find(
                  (a) => a.author_id === Number(e.target.value)
                );
                if (found) setActiveAuthor(found);
              }}
              mb={3}
              textAlign="center"
              fontWeight="semibold"
              bg="whiteAlpha.800"
              fontSize="md"
              color="gray.800"
              borderRadius="md"
            >
              {authors.map((author) => (
                <option key={author.author_id} value={author.author_id}>
                  {author.author_first_name} {author.author_last_name}
                  {author.author_title ? `, ${author.author_title}` : ""}
                </option>
              ))}
            </Select>
          ) : (
            <Box textAlign="center" mb={3}>
              <Text
                fontWeight="semibold"
                fontSize="md"
                bg="whiteAlpha.700"
                color="gray.800"
                borderRadius="md"
                px={2}
                py={1}
              >
                {activeAuthor?.author_first_name}{" "}
                {activeAuthor?.author_last_name}
              </Text>
              {/* 👇 show title right under name */}
              {activeAuthor?.author_title ? (
                <Text fontSize="sm" color="gray.200" mt={1}>
                  {activeAuthor.author_title}
                </Text>
              ) : null}
            </Box>
          )}
          <Center>
            <Box
              as="button"
              onClick={() => fileInputRef.current?.click()}
              cursor="pointer"
              borderRadius="full"
              overflow="hidden"
              border="2px solid #805AD5"
              boxSize="100px"
              display="flex"
              alignItems="center"
              justifyContent="center"
              marginBottom={"10px"}
            >
              {activeAuthor?.author_profile_pic ? (
                <>
                  <Image
                    src={`${API_BASE_URL}/${activeAuthor.author_profile_pic}`}
                    alt="Author"
                    objectFit="cover"
                    boxSize="100px"
                  />
                </>
              ) : (
                <Text fontSize="xs" color="gray.300">
                  Upload
                </Text>
              )}

              {activeAuthor && (
                <input
                  type="file"
                  accept="image/*"
                  ref={fileInputRef}
                  onChange={(e) => {
                    if (e.target.files?.[0]) {
                      handleUpload(e.target.files[0], activeAuthor.author_id);
                    }
                  }}
                  style={{ display: "none" }}
                />
              )}
            </Box>
          </Center>

          <HStack justify="center" spacing={4} mt={1}>
            <Flex direction="column" align="center" className="mr-metric">
              <Text className="mr-metric-label">Bias</Text>
              <Flex align="center" gap={1}>
                <Text>{getBiasEmoji(parseFloat(avgScore("bias_score")))}</Text>
                <Text className="mr-metric-value">
                  {avgScore("bias_score")}
                </Text>
              </Flex>
            </Flex>
            <Flex direction="column" align="center" className="mr-metric">
              <Text className="mr-metric-label">Veracity</Text>
              <Flex align="center" gap={1}>
                <Text>
                  {getVeracityEmoji(parseFloat(avgScore("veracity_score")))}
                </Text>
                <Text className="mr-metric-value">
                  {avgScore("veracity_score")}
                </Text>
              </Flex>
            </Flex>
          </HStack>
          <Box />
          <Text className="mr-text-secondary" fontSize="sm" mt={1} textAlign="center">
            {activeAuthor?.description || "No bio available."}
          </Text>
        </Box>
        <Center>
          <Menu>
            <MenuButton as={Button} className="mr-button" mt={3}>
              Actions
            </MenuButton>
            <MenuList>
              <MenuItem
                onClick={() => {
                  setActiveAuthor(activeAuthor);
                  onBioOpen();
                }}
              >
                ✏️ Edit Bio
              </MenuItem>
              <MenuItem
                onClick={() => {
                  setActiveAuthor(activeAuthor);
                  onRatingOpen();
                }}
              >
                📊 Manage Ratings
              </MenuItem>
              {contentId && (
                <>
                  <MenuItem onClick={onAddAuthorOpen}>
                    ➕ Add Author
                  </MenuItem>
                  {activeAuthor && authorList.length > 1 && (
                    <MenuItem onClick={handleRemoveAuthor} color="red.400">
                      🗑️ Remove Author
                    </MenuItem>
                  )}
                </>
              )}
            </MenuList>
          </Menu>
        </Center>

        {activeAuthor && isBioOpen && (
          <AuthBioModal
            isOpen={isBioOpen}
            onClose={onBioClose}
            authorId={activeAuthor.author_id}
            currentBio={activeAuthor.description}
            onSave={async (newBio) => {
              await updateAuthorBio(activeAuthor.author_id, newBio);
              setAuthorList((prev) =>
                prev.map((a) =>
                  a.author_id === activeAuthor.author_id
                    ? { ...a, description: newBio }
                    : a
                )
              );
              setActiveAuthor((prev) =>
                prev ? { ...prev, description: newBio } : prev
              );
              toast({
                title: "Bio Updated",
                description: "Author biography saved.",
                status: "success",
                duration: 3000,
                isClosable: true,
              });
            }}
          />
        )}

        {activeAuthor && isRatingOpen && (
          <AuthRatingModal
            isOpen={isRatingOpen}
            onClose={onRatingClose}
            authorId={activeAuthor.author_id}
            onRatingsUpdate={handleRatingsUpdate}
          />
        )}

        {contentId && (
          <ResponsiveOverlay
            isOpen={isAddAuthorOpen}
            onClose={onAddAuthorClose}
            title="Add Author"
            footer={
              <>
                <Button className="mr-button" mr={3} onClick={handleAddAuthor}>
                  Add
                </Button>
                <Button onClick={onAddAuthorClose}>Cancel</Button>
              </>
            }
            size="md"
          >
            <VStack spacing={4} align="stretch">
              <Text className="mr-text-primary">
                Enter the author's name (e.g., "John Smith" or "Dr. Jane Doe, PhD")
              </Text>
              <Input
                className="mr-input"
                placeholder="Author name"
                value={newAuthorName}
                onChange={(e) => setNewAuthorName(e.target.value)}
                onKeyPress={(e) => {
                  if (e.key === "Enter") {
                    handleAddAuthor();
                  }
                }}
              />
            </VStack>
          </ResponsiveOverlay>
        )}
      </Box>
    </Center>
  );
};

export default AuthCard;
