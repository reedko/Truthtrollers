import {
  Box,
  Image,
  Text,
  Center,
  Menu,
  MenuButton,
  MenuList,
  MenuItem,
  Button,
  Input,
  VStack,
  HStack,
  useDisclosure,
  useToast,
  Badge,
  Flex,
  Tooltip,
} from "@chakra-ui/react";
import { Publisher, PublisherRating } from "../../../shared/entities/types";
import { BiChevronDown } from "react-icons/bi";
import {
  uploadImage,
  fetchPublisherRatings,
  fetchPublisher,
} from "../services/useDashboardAPI";
import PubRatingModal from "./modals/PubRatingModal";
import { useEffect, useRef, useState } from "react";

interface PubCardProps {
  publishers: Publisher[];
}

const PubCard: React.FC<PubCardProps> = ({ publishers }) => {
  const [activePublisher, setActivePublisher] = useState<Publisher | null>(
    publishers[0]
  );
  const [ratings, setRatings] = useState<PublisherRating[]>([]);
  const { isOpen, onOpen, onClose } = useDisclosure();
  const toast = useToast();
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [allRatings, setAllRatings] = useState<{
    [publisherId: number]: PublisherRating[];
  }>({});
  const [publisherList, setPublisherList] = useState<Publisher[]>(publishers);
  const MAX_VISIBLE_RATINGS = 3;
  const [showAllRatings, setShowAllRatings] = useState<{
    [id: number]: boolean;
  }>({});

  useEffect(() => {
    if (publishers.length > 0) {
      setPublisherList(publishers);
    }
  }, [publishers]);

  const getBiasEmoji = (score: number) => {
    if (score <= -5 || score >= 5) return "🔴";
    return "🟢";
  };

  const getVeracityEmoji = (score: number) => {
    if (score > 5) return "🟢";
    if (score < 0) return "🔴";
    return "⚪";
  };

  useEffect(() => {
    const loadAllRatings = async () => {
      const map: { [publisherId: number]: PublisherRating[] } = {};
      for (const pub of publishers) {
        const pubRatings = await fetchPublisherRatings(pub.publisher_id);
        map[pub.publisher_id] = pubRatings;
      }
      setAllRatings(map);
    };

    if (publishers.length) loadAllRatings();
  }, [publishers]);

  useEffect(() => {
    const loadRatings = async () => {
      if (activePublisher) {
        const ratings = await fetchPublisherRatings(
          activePublisher.publisher_id
        );
        setRatings(ratings);
      }
    };
    loadRatings();
  }, [activePublisher]);

  const handleRatingsUpdate = (
    publisherId: number,
    updated: PublisherRating[]
  ) => {
    setAllRatings((prev) => ({
      ...prev,
      [publisherId]: updated,
    }));
  };

  const handleUpload = async (file: File, publisherId: number) => {
    const result = await uploadImage(publisherId, file, "publishers");
    if (result) {
      toast({
        title: "Image Uploaded",
        description: "Publisher icon updated!",
        status: "success",
        duration: 3000,
        isClosable: true,
      });
      const updatedPublisher = await fetchPublisher(publisherId);
      if (updatedPublisher) {
        setPublisherList((prev) =>
          prev.map((a: Publisher) =>
            a.publisher_id === publisherId ? updatedPublisher : a
          )
        );
        setActivePublisher(updatedPublisher);
      }
    }
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
          Publisher Details
        </Text>

        {publisherList.map((pub, idx) => (
          <Box key={idx} mb={4}>
            {pub.publisher_icon && (
              <Center mb={2}>
                <Image
                  src={`${import.meta.env.VITE_API_BASE_URL}/${
                    pub.publisher_icon
                  }`}
                  alt={pub.publisher_name}
                  borderRadius="full"
                  boxSize="80px"
                  objectFit="cover"
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
                  handleUpload(e.target.files[0], pub.publisher_id);
                }
              }}
            />

            <Text fontWeight="semibold" fontSize="md">
              {pub.publisher_name}
            </Text>

            {allRatings[pub.publisher_id]?.length > 0 && (
              <Box mt={3} bg="whiteAlpha.600" p={2} borderRadius="md" w="100%">
                <Text fontWeight="medium" fontSize="sm" mb={1}>
                  Ratings:
                </Text>

                <HStack fontWeight="bold" fontSize="sm" spacing={4} w="100%">
                  <Box flex="1">Source (Topic)</Box>
                  <Box minW="80px" textAlign="center" color="purple.600">
                    Bias
                  </Box>
                  <Box minW="90px" textAlign="center" color="green.600">
                    Veracity
                  </Box>
                </HStack>

                <VStack spacing={1} align="start" w="100%">
                  {(showAllRatings[pub.publisher_id]
                    ? allRatings[pub.publisher_id]
                    : allRatings[pub.publisher_id].slice(0, MAX_VISIBLE_RATINGS)
                  ).map((r, i) => (
                    <HStack key={i} fontSize="sm" spacing={4} w="100%">
                      <Box flex="1">
                        <Tooltip label={r.topic_name} hasArrow>
                          <Text isTruncated fontWeight="semibold" maxW="140px">
                            {r.source}
                            {""}
                            <Text as="span" color="gray.500" fontSize="xs">
                              ({r.topic_name})
                            </Text>
                          </Text>
                        </Tooltip>
                      </Box>

                      <Badge minW="80px" px={2} borderRadius="md" bg="gray.600">
                        <Flex justify="space-between" w="full">
                          <Text>{getBiasEmoji(r.bias_score)}</Text>
                          <Text>{r.bias_score?.toFixed(1)}</Text>
                        </Flex>
                      </Badge>
                      <Badge minW="90px" px={2} borderRadius="md" bg="gray.600">
                        <Flex justify="space-between" w="full">
                          <Text>{getVeracityEmoji(r.veracity_score)}</Text>
                          <Text>{r.veracity_score?.toFixed(1)}</Text>
                        </Flex>
                      </Badge>
                    </HStack>
                  ))}
                </VStack>

                {allRatings[pub.publisher_id].length > MAX_VISIBLE_RATINGS && (
                  <Button
                    size="sm"
                    variant="ghost"
                    mt={2}
                    onClick={() =>
                      setShowAllRatings((prev) => ({
                        ...prev,
                        [pub.publisher_id]: !prev[pub.publisher_id],
                      }))
                    }
                  >
                    {showAllRatings[pub.publisher_id]
                      ? "Show Less"
                      : "Show All"}
                  </Button>
                )}
              </Box>
            )}

            <Menu>
              <MenuButton as={Button} rightIcon={<BiChevronDown />} mt={2}>
                Actions
              </MenuButton>
              <MenuList>
                <MenuItem
                  onClick={() => {
                    setActivePublisher(pub);
                    onOpen();
                  }}
                >
                  📊 Manage Ratings
                </MenuItem>
              </MenuList>
            </Menu>
          </Box>
        ))}

        {activePublisher && isOpen && (
          <PubRatingModal
            isOpen={isOpen}
            onClose={onClose}
            publisherId={activePublisher.publisher_id}
            onRatingsUpdate={handleRatingsUpdate}
          />
        )}
      </Box>
    </Center>
  );
};

export default PubCard;
