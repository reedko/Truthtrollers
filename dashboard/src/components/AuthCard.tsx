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
  fetchAuthors,
  fetchAuthor,
} from "../services/useDashboardAPI";

interface AuthCardProps {
  authors: Author[];
}

const AuthCard: React.FC<AuthCardProps> = ({ authors }) => {
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
  useEffect(() => {
    if (authors.length > 0) {
      setAuthorList(authors);
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
    setAllRatings((prev) => ({
      ...prev,
      [authorId]: updated,
    }));
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

      // 🔄 Refresh the updated author
      const updatedAuthor = await fetchAuthor(authorId);
      console.log(updatedAuthor, ":JJDJDJ");
      if (updatedAuthor) {
        setAuthorList((prev) =>
          prev.map((a) => (a.author_id === authorId ? updatedAuthor : a))
        );
        setActiveAuthor(updatedAuthor);
      }
    }
  };

  const getBiasEmoji = (score: number) => {
    if (score <= -5 || score >= 5) return "🔴";
    return "🟢";
  };

  const getVeracityEmoji = (score: number) => {
    if (score > 5) return "🟢";
    if (score < 0) return "🔴";
    return "⚪";
  };

  return (
    <Center>
      <Box
        ref={cardRef}
        bg="teal.500"
        borderWidth="1px"
        borderRadius="lg"
        boxShadow="md"
        p={4}
        width="100%"
        maxW="400px"
        margin="10px"
      >
        <Text fontWeight="bold" fontSize="lg" mb={2}>
          Author Details
        </Text>

        <Tabs isFitted variant="enclosed">
          <TabList>
            {authors.map((author, idx) => (
              <Tab key={idx}>
                {author.author_first_name} {author.author_last_name}
              </Tab>
            ))}
          </TabList>
          <TabPanels>
            {authorList.map((author, idx) => (
              <TabPanel key={idx}>
                {author.author_profile_pic && (
                  <Center mb={3}>
                    <Image
                      src={`${import.meta.env.VITE_API_BASE_URL}/${
                        author.author_profile_pic
                      }`}
                      alt={`${author.author_first_name} ${author.author_last_name}`}
                      borderRadius="full"
                      boxSize="100px"
                      objectFit="cover"
                      border="2px solid #805AD5"
                    />
                  </Center>
                )}

                <Input
                  type="file"
                  accept="image/*"
                  size="sm"
                  mb={2}
                  onChange={(e) => {
                    if (e.target.files?.[0]) {
                      handleUpload(e.target.files[0], author.author_id);
                    }
                  }}
                />

                <Text fontWeight="semibold">
                  {author.author_first_name} {author.author_last_name}
                </Text>
                <Text fontSize="sm" color="gray.600" mt={1}>
                  {author.description || "No bio available."}
                </Text>

                {allRatings[author.author_id]?.length > 0 && (
                  <Box mt={3} bg="whiteAlpha.600" p={2} borderRadius="md">
                    <Text fontWeight="medium" fontSize="sm" mb={1}>
                      Ratings:
                    </Text>
                    {/* Header row */}
                    <HStack
                      fontWeight="bold"
                      fontSize="sm"
                      spacing={4}
                      w="100%"
                    >
                      <Box flex="1">Source (Topic)</Box>
                      <Box w="70px" textAlign="right" color="purple.600">
                        Bias
                      </Box>
                      <Box w="90px" textAlign="right" color="green.600">
                        Veracity
                      </Box>
                    </HStack>
                    <VStack spacing={1} align="start">
                      {allRatings[author.author_id].map((r, i) => (
                        <HStack key={i} fontSize="sm" spacing={6}>
                          <Box flex="1">
                            <Text isTruncated fontWeight="semibold">
                              {r.source}{" "}
                              <Text as="span" color="gray.500" fontSize="xs">
                                ({r.topic_name})
                              </Text>
                            </Text>
                          </Box>
                          <Badge
                            w="90px"
                            px={2}
                            borderRadius="md"
                            bg="gray.600"
                          >
                            <Flex justify="space-between" w="full">
                              <Text>{getBiasEmoji(r.bias_score)}</Text>
                              <Text>{r.bias_score?.toFixed(1)}</Text>
                            </Flex>
                          </Badge>
                          <Badge
                            w="90px"
                            px={2}
                            borderRadius="md"
                            bg="gray.600"
                          >
                            <Flex justify="space-between" w="full">
                              <Text>{getVeracityEmoji(r.veracity_score)}</Text>
                              <Text>{r.veracity_score?.toFixed(1)}</Text>
                            </Flex>
                          </Badge>
                        </HStack>
                      ))}
                    </VStack>
                  </Box>
                )}

                <Menu>
                  <MenuButton as={Button} rightIcon={<BiChevronDown />} mt={3}>
                    Actions
                  </MenuButton>
                  <MenuList>
                    <MenuItem
                      onClick={() => {
                        setActiveAuthor(author);
                        onBioOpen();
                      }}
                    >
                      ✏️ Edit Bio
                    </MenuItem>
                    <MenuItem
                      onClick={() => {
                        setActiveAuthor(author);
                        onRatingOpen();
                      }}
                    >
                      📊 Manage Ratings
                    </MenuItem>
                  </MenuList>
                </Menu>
              </TabPanel>
            ))}
          </TabPanels>
        </Tabs>

        {activeAuthor && isBioOpen && (
          <AuthBioModal
            isOpen={isBioOpen}
            onClose={onBioClose}
            authorId={activeAuthor.author_id}
            currentBio={activeAuthor.description}
            onSave={async (newBio) => {
              await updateAuthorBio(activeAuthor.author_id, newBio);

              // Update local state so the card reflects the new bio
              setAuthorList((prev) =>
                prev.map((a) =>
                  a.author_id === activeAuthor.author_id
                    ? { ...a, description: newBio }
                    : a
                )
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
