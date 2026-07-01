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
  Select,
} from "@chakra-ui/react";
import { Author, AuthorRating } from "../../../shared/entities/types";
import { useRef, useState, useEffect } from "react";
import AuthBioModal from "./modals/AuthBioModal";
import AuthRatingModal from "./modals/AuthRatingModal";
import CredibilityInfoModal from "./modals/CredibilityInfoModal";
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

const authorTitleSx = {
  position: "relative",
  overflow: "hidden",
  bg: "linear-gradient(135deg, rgba(15, 23, 42, 0.92), rgba(30, 41, 59, 0.82))",
  border: "1px solid rgba(139, 92, 246, 0.58)",
  color: "rgba(221, 214, 254, 0.97)",
  boxShadow:
    "0 8px 24px rgba(0,0,0,0.45), 0 0 24px rgba(139, 92, 246, 0.24), inset 0 1px 0 rgba(255,255,255,0.12)",
  _before: {
    content: '""',
    position: "absolute",
    left: 0,
    top: 0,
    width: "20px",
    height: "100%",
    background: "linear-gradient(90deg, rgba(139, 92, 246, 0.42) 0%, rgba(139, 92, 246, 0) 100%)",
    borderLeftRadius: "md",
    pointerEvents: "none",
  },
} as const;

const ratingPillSx = {
  border: "1px solid rgba(139, 92, 246, 0.5)",
  bg: "linear-gradient(135deg, rgba(15, 23, 42, 0.82), rgba(49, 46, 129, 0.35))",
  color: "rgba(237, 233, 254, 0.96)",
  borderRadius: "10px",
  px: 2,
  py: 1,
  minW: 0,
  flex: 1,
  justifyContent: "space-between",
  boxShadow:
    "inset 0 1px 0 rgba(255,255,255,0.18), inset 0 -1px 0 rgba(0,0,0,0.35), 0 0 10px rgba(139,92,246,0.28)",
} as const;

const AuthCard: React.FC<AuthCardProps> = ({
  authors,
  compact = false,
  contentId,
}) => {
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
  const {
    isOpen: isBioPopupOpen,
    onOpen: onBioPopupOpen,
    onClose: onBioPopupClose,
  } = useDisclosure();
  const {
    isOpen: isCredibilityOpen,
    onOpen: onCredibilityOpen,
    onClose: onCredibilityClose,
  } = useDisclosure();

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
          prev.map((a) => (a.author_id === authorId ? updatedAuthor : a)),
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
      activeAuthor.author_id,
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
        p={compact ? 1 : 3}
        w="100%"
        height={compact ? "130px" : "405px"}
        display="flex"
        flexDirection="column"
        justifyContent="space-between"
      >
        <div className="mr-glow-bar mr-glow-bar-purple" />
        <div className="mr-scanlines" />
        <Box flex="1" minH={0} overflow="hidden">
          <Center>
            <Text
              className="mr-badge mr-badge-purple"
              fontSize={compact ? "7px" : "sm"}
              mb={compact ? 0 : 1}
              lineHeight={compact ? "1" : "normal"}
            >
              Author Details
            </Text>
          </Center>
          {authors.length > 1 ? (
            <Select
              size={compact ? "xs" : "sm"}
              value={activeAuthor?.author_id}
              onChange={(e) => {
                const found = authors.find(
                  (a) => a.author_id === Number(e.target.value),
                );
                if (found) setActiveAuthor(found);
              }}
              mb={compact ? 1 : 3}
              textAlign="center"
              fontWeight="semibold"
              bg="whiteAlpha.800"
              fontSize={compact ? "8px" : "md"}
              h={compact ? "18px" : "auto"}
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
            <Box textAlign="center" mt={compact ? 0 : 2} mb={compact ? 1 : 2}>
              <Text
                fontWeight="semibold"
                fontSize={compact ? "9px" : "lg"}
                borderRadius="md"
                px={compact ? 1 : 2}
                py={compact ? 0 : 1}
                minH={compact ? "18px" : "52px"}
                h={compact ? "18px" : "52px"}
                display="flex"
                alignItems="center"
                justifyContent="center"
                noOfLines={1}
                overflow="hidden"
                textOverflow="ellipsis"
                sx={authorTitleSx}
              >
                {activeAuthor?.author_first_name}{" "}
                {activeAuthor?.author_last_name}
                {!compact && activeAuthor?.author_title
                  ? `, ${activeAuthor.author_title}`
                  : ""}
              </Text>
            </Box>
          )}
          <VStack spacing={0}>
            <Box
              as="button"
              onClick={() => fileInputRef.current?.click()}
              cursor="pointer"
              borderRadius="full"
              overflow="hidden"
              border="2px solid #805AD5"
              boxSize={compact ? "40px" : "100px"}
              display="flex"
              alignItems="center"
              justifyContent="center"
              mt={compact ? 0 : "25px"}
              marginBottom={compact ? "2px" : "8px"}
            >
              {activeAuthor?.author_profile_pic ? (
                <>
                  <Image
                    src={`${API_BASE_URL}/${activeAuthor.author_profile_pic}`}
                    alt="Author"
                    objectFit="cover"
                    boxSize={compact ? "40px" : "100px"}
                  />
                </>
              ) : (
                <Text fontSize={compact ? "7px" : "xs"} color="gray.300">
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
          </VStack>

          {!compact && (
            <HStack align="stretch" spacing={2} mt={1} px={1}>
              <HStack spacing={1.5} sx={ratingPillSx}>
                <Text
                  fontSize="10px"
                  fontWeight="700"
                  letterSpacing="0.08em"
                  textTransform="uppercase"
                  color="purple.200"
                >
                  Bias
                </Text>
                <HStack spacing={1}>
                  <Text fontSize="xs">{getBiasEmoji(parseFloat(avgScore("bias_score")))}</Text>
                  <Text fontSize="sm" fontWeight="bold" lineHeight="1">
                    {avgScore("bias_score")}
                  </Text>
                </HStack>
              </HStack>
              <HStack spacing={1.5} sx={ratingPillSx}>
                <Text
                  fontSize="10px"
                  fontWeight="700"
                  letterSpacing="0.08em"
                  textTransform="uppercase"
                  color="purple.200"
                >
                  Veracity
                </Text>
                <HStack spacing={1}>
                  <Text fontSize="xs">
                    {getVeracityEmoji(parseFloat(avgScore("veracity_score")))}
                  </Text>
                  <Text fontSize="sm" fontWeight="bold" lineHeight="1">
                    {avgScore("veracity_score")}
                  </Text>
                </HStack>
              </HStack>
            </HStack>
          )}
          {!compact && (
            <>
              <Box />
              <Box
                mt={1}
                textAlign="center"
                onClick={activeAuthor?.description && activeAuthor.description.length > 100 ? onBioPopupOpen : undefined}
                cursor={activeAuthor?.description && activeAuthor.description.length > 100 ? "pointer" : "default"}
                _hover={activeAuthor?.description && activeAuthor.description.length > 100 ? { opacity: 0.8 } : undefined}
              >
                <Text
                  className="mr-text-secondary"
                  fontSize="sm"
                  noOfLines={1}
                  sx={{
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    display: "-webkit-box",
                    WebkitBoxOrient: "vertical",
                  }}
                >
                  {activeAuthor?.description || "No bio available."}
                </Text>
              </Box>
            </>
          )}
        </Box>
        <Center w="100%">
          <Box w={compact ? "100%" : "50%"} minW={0}>
          <Menu isLazy>
            <MenuButton
              as={Button}
              className="mr-button"
              w="100%"
              size={compact ? "xs" : "md"}
              fontSize={compact ? "8px" : "md"}
              h={compact ? "20px" : "auto"}
              px={compact ? 1 : undefined}
            >
              Actions
            </MenuButton>
            <MenuList zIndex={9999}>
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
              <MenuItem onClick={() => onCredibilityOpen()}>
                🔍 Check Credibility
              </MenuItem>
              {contentId && (
                <>
                  <MenuItem onClick={onAddAuthorOpen}>➕ Add Author</MenuItem>
                  {activeAuthor && authorList.length > 1 && (
                    <MenuItem onClick={handleRemoveAuthor} color="red.400">
                      🗑️ Remove Author
                    </MenuItem>
                  )}
                </>
              )}
            </MenuList>
          </Menu>
          </Box>
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
                    : a,
                ),
              );
              setActiveAuthor((prev) =>
                prev ? { ...prev, description: newBio } : prev,
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
                Enter the author's name (e.g., "John Smith" or "Dr. Jane Doe,
                PhD")
              </Text>
              <Input
                className="mr-input"
                placeholder="Author name"
                value={newAuthorName}
                onChange={(e) => setNewAuthorName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    handleAddAuthor();
                  }
                }}
              />
            </VStack>
          </ResponsiveOverlay>
        )}

        {activeAuthor && (
          <ResponsiveOverlay
            isOpen={isBioPopupOpen}
            onClose={onBioPopupClose}
            title={`${activeAuthor.author_first_name} ${activeAuthor.author_last_name} - Bio`}
            footer={
              <Button onClick={onBioPopupClose} className="mr-button">
                Close
              </Button>
            }
            size="md"
          >
            <Box
              maxH="400px"
              overflowY="auto"
              p={4}
              className="mr-text-secondary"
              fontSize="sm"
            >
              {activeAuthor.description || "No bio available."}
            </Box>
          </ResponsiveOverlay>
        )}

        {activeAuthor && isCredibilityOpen && (
          <CredibilityInfoModal
            isOpen={isCredibilityOpen}
            onClose={onCredibilityClose}
            entityType="author"
            entityId={activeAuthor.author_id}
            entityName={`${activeAuthor.author_first_name} ${activeAuthor.author_last_name}`}
          />
        )}
      </Box>
    </Center>
  );
};

export default AuthCard;
