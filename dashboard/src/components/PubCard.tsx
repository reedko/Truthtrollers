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
} from "@chakra-ui/react";
import { Publisher, PublisherRating } from "../../../shared/entities/types";
import { BiChevronDown } from "react-icons/bi";
import {
  uploadImage,
  fetchPublisherRatings,
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

  useEffect(() => {
    const loadAllRatings = async () => {
      const ratingsMap: { [publisherId: number]: PublisherRating[] } = {};

      for (const pub of publishers) {
        const ratings = await fetchPublisherRatings(pub.publisher_id);
        ratingsMap[pub.publisher_id] = ratings;
      }

      setAllRatings(ratingsMap);
    };

    if (publishers.length > 0) {
      loadAllRatings();
    }
  }, [publishers]);
  const handleRatingsUpdate = (updated: PublisherRating[]) => {
    setRatings(updated);
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

        {publishers.map((pub, idx) => (
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
              <Box mt={2}>
                {allRatings[pub.publisher_id].map((r, i) => (
                  <Text fontSize="sm" key={i}>
                    ⭐ {r.source}: {r.bias_score} bias, {r.veracity_score}{" "}
                    veracity ({r.topic_name})
                  </Text>
                ))}
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
