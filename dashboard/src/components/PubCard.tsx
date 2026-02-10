// src/components/PubCard.tsx
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
  Select,
} from "@chakra-ui/react";
import { Publisher, PublisherRating } from "../../../shared/entities/types";
import { BiChevronDown } from "react-icons/bi";
import {
  uploadImage,
  fetchPublisherRatings,
  fetchPublisher,
  updatePublisherBio,
} from "../services/useDashboardAPI";
import PubRatingModal from "./modals/PubRatingModal";
import PubBioModal from "./modals/PubBioModal";
import ViewRatingsModal from "./modals/ViewRatingsModal";
import { useEffect, useRef, useState } from "react";

interface PubCardProps {
  publishers: Publisher[];
  compact?: boolean;
}

const PubCard: React.FC<PubCardProps> = ({ publishers, compact }) => {
  const [activePublisher, setActivePublisher] = useState<Publisher | null>(
    publishers[0]
  );
  const [ratings, setRatings] = useState<PublisherRating[]>([]);
  const [publisherList, setPublisherList] = useState<Publisher[]>(publishers);
  const [allRatings, setAllRatings] = useState<{
    [publisherId: number]: PublisherRating[];
  }>({});
  const toast = useToast();
  const cardRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const {
    isOpen: isRatingOpen,
    onOpen: onRatingOpen,
    onClose: onRatingClose,
  } = useDisclosure();
  const {
    isOpen: isViewRatingsOpen,
    onOpen: onViewRatingsOpen,
    onClose: onViewRatingsClose,
  } = useDisclosure();
  const {
    isOpen: isBioOpen,
    onOpen: onBioOpen,
    onClose: onBioClose,
  } = useDisclosure();

  useEffect(() => {
    if (publishers.length > 0) {
      setPublisherList(publishers);
      setActivePublisher(publishers[0]);
    }
  }, [publishers]);

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
          prev.map((a) =>
            a.publisher_id === publisherId ? updatedPublisher : a
          )
        );
        setActivePublisher(updatedPublisher);
      }
    }
  };

  const avgScore = (ratings: PublisherRating[], key: keyof PublisherRating) => {
    const values = ratings.map((r) => r[key] as number);
    const avg = values.reduce((acc, val) => acc + val, 0) / values.length;
    return avg.toFixed(1);
  };

  const getBiasEmoji = (score: number) =>
    score <= -5 || score >= 5 ? "🔴" : "🟢";
  const getVeracityEmoji = (score: number) =>
    score > 5 ? "🟢" : score < 0 ? "🔴" : "⚪";

  // Show placeholder if no publisher
  const currentRatings = activePublisher ? (allRatings[activePublisher.publisher_id] || []) : [];
  const avgBias = currentRatings.length
    ? avgScore(currentRatings, "bias_score")
    : "-";
  const avgVeracity = currentRatings.length
    ? avgScore(currentRatings, "veracity_score")
    : "-";
  const handleSaveBio = async (newBio: string) => {
    if (!activePublisher) return;

    await updatePublisherBio(activePublisher.publisher_id, newBio);

    // 🔄 Update publisherList
    setPublisherList((prev) =>
      prev.map((p) =>
        p.publisher_id === activePublisher.publisher_id
          ? { ...p, description: newBio }
          : p
      )
    );

    // 🔄 Update activePublisher
    setActivePublisher((prev) =>
      prev && prev.publisher_id === activePublisher.publisher_id
        ? { ...prev, description: newBio }
        : prev
    );

    toast({
      title: "Description Updated",
      description: "Publisher bio updated successfully.",
      status: "success",
      duration: 3000,
      isClosable: true,
    });
  };

  // If no publisher, show placeholder
  const displayName = activePublisher?.publisher_name || "Unknown Publisher";
  const hasPublisher = !!activePublisher;

  return (
    <Center>
      <Box
        ref={cardRef}
        className="mr-card mr-card-yellow"
        p={3}
        w="100%"
        height="405px"
        display="flex"
        flexDirection="column"
        justifyContent="space-between"
      >
        <div className="mr-glow-bar mr-glow-bar-yellow" />
        <div className="mr-scanlines" />
        <Box>
          <Center>
            <Text className="mr-badge mr-badge-yellow" fontSize="md" mb={2}>
              Publisher Details
            </Text>
          </Center>

          {publisherList.length > 1 ? (
            <Select
              size="sm"
              value={activePublisher?.publisher_id}
              onChange={(e) => {
                const selected = publisherList.find(
                  (p) => p.publisher_id === parseInt(e.target.value)
                );
                if (selected) setActivePublisher(selected);
              }}
              mb={3}
              textAlign="center"
              bg="whiteAlpha.800"
              color="gray.800"
              borderRadius="md"
            >
              {publisherList.map((pub) => (
                <option key={pub.publisher_id} value={pub.publisher_id}>
                  {pub.publisher_name}
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
              {displayName}
            </Text>
          )}

          <Center>
            <Box
              as="button"
              onClick={() => hasPublisher && fileInputRef.current?.click()}
              cursor={hasPublisher ? "pointer" : "not-allowed"}
              borderRadius="full"
              overflow="hidden"
              border="2px solid #ccc"
              boxSize="100px"
              display="flex"
              alignItems="center"
              justifyContent="center"
              marginBottom={"10px"}
              opacity={hasPublisher ? 1 : 0.5}
            >
              {activePublisher?.publisher_icon ? (
                <Image
                  src={`${import.meta.env.VITE_API_BASE_URL}/${
                    activePublisher.publisher_icon
                  }`}
                  alt={activePublisher.publisher_name}
                  boxSize="100px"
                  objectFit="cover"
                />
              ) : (
                <Text fontSize="xs" color="gray.300">
                  {hasPublisher ? "Upload" : "No Icon"}
                </Text>
              )}
            </Box>
            <input
              type="file"
              accept="image/*"
              ref={fileInputRef}
              onChange={(e) => {
                if (e.target.files?.[0] && activePublisher) {
                  handleUpload(e.target.files[0], activePublisher.publisher_id);
                }
              }}
              style={{ display: "none" }}
            />
          </Center>

          <HStack justify="center" spacing={4} mt={2}>
            <Flex direction="column" align="center" className="mr-metric">
              <Text className="mr-metric-label">Bias</Text>
              <Flex align="center" gap={1}>
                <Text>{getBiasEmoji(parseFloat(avgBias))}</Text>
                <Text className="mr-metric-value">
                  {avgBias}
                </Text>
              </Flex>
            </Flex>
            <Flex direction="column" align="center" className="mr-metric">
              <Text className="mr-metric-label">Veracity</Text>
              <Flex align="center" gap={1}>
                <Text>{getVeracityEmoji(parseFloat(avgVeracity))}</Text>
                <Text className="mr-metric-value">
                  {avgVeracity}
                </Text>
              </Flex>
            </Flex>
          </HStack>

          {activePublisher?.description && (
            <Text
              className="mr-text-secondary"
              fontSize="sm"
              mt={3}
              px={2}
              textAlign="center"
            >
              {activePublisher.description}
            </Text>
          )}

          {!hasPublisher && (
            <Text
              className="mr-text-secondary"
              fontSize="sm"
              mt={3}
              px={2}
              textAlign="center"
              color="gray.500"
            >
              No publisher information available
            </Text>
          )}
        </Box>

        <Center>
          <HStack justify="center" spacing={2} w="100%">
            <Button
              onClick={onViewRatingsOpen}
              className="mr-button"
              flex="1"
              isDisabled={!hasPublisher}
            >
              Ratings
            </Button>
            <Menu>
              <MenuButton
                as={Button}
                className="mr-button"
                flex="1"
                isDisabled={!hasPublisher}
              >
                Actions
              </MenuButton>
              <MenuList>
                <MenuItem onClick={() => onRatingOpen()}>
                  📊 Manage Ratings
                </MenuItem>
                <MenuItem onClick={() => onBioOpen()}>
                  ✏️ Edit Description
                </MenuItem>
              </MenuList>
            </Menu>
          </HStack>
        </Center>

        <ViewRatingsModal
          isOpen={isViewRatingsOpen}
          onClose={onViewRatingsClose}
          ratings={currentRatings}
        />

        {activePublisher && isRatingOpen && (
          <PubRatingModal
            isOpen={isRatingOpen}
            onClose={onRatingClose}
            publisherId={activePublisher.publisher_id}
            onRatingsUpdate={handleRatingsUpdate}
          />
        )}

        {activePublisher && isBioOpen && (
          <PubBioModal
            isOpen={isBioOpen}
            onClose={onBioClose}
            publisherId={activePublisher.publisher_id}
            currentBio={activePublisher.description}
            onSave={handleSaveBio}
          />
        )}
      </Box>
    </Center>
  );
};

export default PubCard;
