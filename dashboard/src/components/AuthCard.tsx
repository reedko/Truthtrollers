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
import {
  uploadImage,
  fetchAuthorRatings,
  updateAuthorBio,
  fetchAuthor,
} from "../services/useDashboardAPI";

interface AuthCardProps {
  authors: Author[];
  compact?: boolean;
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;
const AuthCard: React.FC<AuthCardProps> = ({ authors, compact = false }) => {
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
  const [activeAuthor, setActiveAuthor] = useState<Author | null>(authors[0]);
  const [allRatings, setAllRatings] = useState<{
    [authorId: number]: AuthorRating[];
  }>({});
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
        bg="stat2Gradient"
        borderWidth="1px"
        borderRadius="lg"
        boxShadow="md"
        p={4}
        width="250px"
        height="405px"
        display="flex"
        flexDirection="column"
        justifyContent="space-between"
        margin="10px"
      >
        <Box>
          <Center>
            <Text fontWeight="bold" fontSize="md" mb={2} textAlign="center">
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
                </option>
              ))}
            </Select>
          ) : (
            <Text
              fontWeight="semibold"
              fontSize="md"
              mb={3}
              textAlign="center"
              bg="whiteAlpha.700"
              color="gray.800"
              borderRadius="md"
              px={2}
              py={1}
            >
              {activeAuthor?.author_first_name} {activeAuthor?.author_last_name}
            </Text>
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
            <Flex direction="column" align="center">
              <Text fontSize="md">Bias</Text>
              <Flex align="center" gap={1}>
                <Text>{getBiasEmoji(parseFloat(avgScore("bias_score")))}</Text>
                <Badge
                  fontSize="md"
                  borderRadius="md"
                  px={2}
                  bg="gray.700"
                  color="purple.200"
                >
                  {avgScore("bias_score")}
                </Badge>
              </Flex>
            </Flex>
            <Flex direction="column" align="center">
              <Text fontSize="md">Veracity</Text>
              <Flex align="center" gap={1}>
                <Text>
                  {getVeracityEmoji(parseFloat(avgScore("veracity_score")))}
                </Text>
                <Badge
                  fontSize="md"
                  borderRadius="md"
                  px={2}
                  bg="gray.700"
                  color="green.200"
                >
                  {avgScore("veracity_score")}
                </Badge>
              </Flex>
            </Flex>
          </HStack>
          <Box />
          <Text fontSize="sm" mt={1} textAlign="center">
            {activeAuthor?.description || "No bio available."}
          </Text>
        </Box>
        <Center>
          <Menu>
            <MenuButton as={Button} rightIcon={<BiChevronDown />} mt={3}>
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
      </Box>
    </Center>
  );
};

export default AuthCard;
