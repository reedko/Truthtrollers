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
} from "@chakra-ui/react";
import { BiChevronDown } from "react-icons/bi";
import { Author, AuthorRating } from "../../../shared/entities/types";
import { useEffect, useRef, useState } from "react";
import AuthBioModal from "./modals/AuthBioModal";
import AuthRatingModal from "./modals/AuthRatingModal";
import { fetchAuthorRatings, uploadImage } from "../services/useDashboardAPI";

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

  const toast = useToast();
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [activeAuthor, setActiveAuthor] = useState<Author | null>(authors[0]);
  const [ratings, setRatings] = useState<AuthorRating[]>([]);

  useEffect(() => {
    const loadRatings = async () => {
      if (activeAuthor) {
        const result = await fetchAuthorRatings(activeAuthor.author_id);
        setRatings(result);
      }
    };
    loadRatings();
  }, [activeAuthor]);

  const handleUpload = async (file: File, authorId: number) => {
    const result = await uploadImage(authorId, file, "authors");
    if (result) {
      toast({
        title: "Image Uploaded",
        description: "Author profile image was updated!",
        status: "success",
        duration: 3000,
        isClosable: true,
      });
    }
  };

  const handleOpenModal = (open: () => void, author: Author) => {
    setActiveAuthor(author);
    open();
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

        <Tabs
          isFitted
          variant="enclosed"
          onChange={(i) => setActiveAuthor(authors[i])}
        >
          <TabList>
            {authors.map((author, idx) => (
              <Tab key={idx}>
                {author.author_first_name} {author.author_last_name}
              </Tab>
            ))}
          </TabList>
          <TabPanels>
            {authors.map((author, idx) => (
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

                {/* Ratings */}
                {ratings.length > 0 && (
                  <Box mt={3} bg="whiteAlpha.600" p={2} borderRadius="md">
                    <Text fontWeight="medium" fontSize="sm" mb={1}>
                      Ratings:
                    </Text>
                    <VStack spacing={1} align="start">
                      {ratings.map((r, i) => (
                        <HStack key={i} fontSize="sm" spacing={2}>
                          <Text fontWeight="bold">{r.source}</Text>
                          <Text>({r.topic_name})</Text>
                          <Text color="purple.600">Bias: {r.bias_score}</Text>
                          <Text color="green.600">
                            Veracity: {r.veracity_score}
                          </Text>
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
                      onClick={() => handleOpenModal(onBioOpen, author)}
                    >
                      ✏️ Edit Bio
                    </MenuItem>
                    <MenuItem
                      onClick={() => handleOpenModal(onRatingOpen, author)}
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
            onSave={async () => {}}
          />
        )}

        {activeAuthor && isRatingOpen && (
          <AuthRatingModal
            isOpen={isRatingOpen}
            onClose={onRatingClose}
            authorId={activeAuthor.author_id}
            ratings={ratings}
            onSave={async () => {}}
          />
        )}
      </Box>
    </Center>
  );
};

export default AuthCard;
