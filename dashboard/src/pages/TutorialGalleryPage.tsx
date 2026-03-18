import React, { useState, useEffect } from "react";
import {
  Box,
  Container,
  Heading,
  Grid,
  VStack,
  HStack,
  Text,
  Button,
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalCloseButton,
  ModalFooter,
  Input,
  Textarea,
  FormControl,
  FormLabel,
  useDisclosure,
  Spinner,
  Tag,
  IconButton,
  AspectRatio,
  useToast,
  Center,
} from "@chakra-ui/react";
import { AddIcon, ViewIcon, EditIcon, DeleteIcon } from "@chakra-ui/icons";
import { FiVideo, FiUpload } from "react-icons/fi";
import { api } from "../services/api";
import { useAuthStore } from "../store/useAuthStore";

interface TutorialVideo {
  tutorial_video_id: number;
  title: string;
  description: string | null;
  video_url: string;
  thumbnail_url: string | null;
  duration_seconds: number | null;
  category: string | null;
  created_at: string;
  uploaded_by: string | null;
}

export default function TutorialGalleryPage() {
  const user = useAuthStore((s) => s.user);
  const isSuperAdmin = user?.role === "super_admin";
  const toast = useToast();

  const [videos, setVideos] = useState<TutorialVideo[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [loading, setLoading] = useState(true);
  const [selectedVideo, setSelectedVideo] = useState<TutorialVideo | null>(null);

  // Upload form state
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadThumbnail, setUploadThumbnail] = useState<File | null>(null);
  const [uploadTitle, setUploadTitle] = useState("");
  const [uploadDescription, setUploadDescription] = useState("");
  const [uploadCategory, setUploadCategory] = useState("");
  const [uploading, setUploading] = useState(false);

  // Edit form state
  const [editingVideo, setEditingVideo] = useState<TutorialVideo | null>(null);
  const [editThumbnail, setEditThumbnail] = useState<File | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editCategory, setEditCategory] = useState("");
  const [updating, setUpdating] = useState(false);

  const { isOpen: isPlayerOpen, onOpen: onPlayerOpen, onClose: onPlayerClose } = useDisclosure();
  const { isOpen: isUploadOpen, onOpen: onUploadOpen, onClose: onUploadClose } = useDisclosure();
  const { isOpen: isEditOpen, onOpen: onEditOpen, onClose: onEditClose } = useDisclosure();

  useEffect(() => {
    loadVideos();
    loadCategories();
  }, [selectedCategory]);

  const loadVideos = async () => {
    try {
      setLoading(true);
      const params = selectedCategory !== "all" ? { category: selectedCategory } : {};
      const response = await api.get("/api/tutorials", { params });
      setVideos(response.data.videos || []);
    } catch (error) {
      console.error("Failed to load tutorial videos:", error);
      toast({
        title: "Error loading videos",
        status: "error",
        duration: 3000,
      });
    } finally {
      setLoading(false);
    }
  };

  const loadCategories = async () => {
    try {
      const response = await api.get("/api/tutorials/categories");
      setCategories(response.data.categories || []);
    } catch (error) {
      console.error("Failed to load categories:", error);
    }
  };

  const handleVideoClick = (video: TutorialVideo) => {
    setSelectedVideo(video);
    onPlayerOpen();
  };

  const handleClosePlayer = () => {
    setSelectedVideo(null);
    onPlayerClose();
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files[0]) {
      setUploadFile(event.target.files[0]);
    }
  };

  const handleThumbnailSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files[0]) {
      setUploadThumbnail(event.target.files[0]);
    }
  };

  const handleUpload = async () => {
    if (!uploadFile || !uploadTitle) {
      toast({
        title: "Missing required fields",
        description: "Please provide a video file and title",
        status: "warning",
        duration: 3000,
      });
      return;
    }

    try {
      setUploading(true);

      const formData = new FormData();
      formData.append("video", uploadFile);
      if (uploadThumbnail) formData.append("thumbnail", uploadThumbnail);
      formData.append("title", uploadTitle);
      if (uploadDescription) formData.append("description", uploadDescription);
      if (uploadCategory) formData.append("category", uploadCategory);

      // Use direct subdomain to bypass Cloudflare's 100MB limit
      const uploadUrl = import.meta.env.PROD
        ? "https://direct.truthtrollers.com/api/tutorials/upload"
        : "/api/tutorials/upload";

      await api.post(uploadUrl, formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });

      toast({
        title: "Video uploaded successfully!",
        status: "success",
        duration: 3000,
      });

      onUploadClose();
      resetUploadForm();
      loadVideos();
      loadCategories();
    } catch (error: any) {
      console.error("Upload failed:", error);

      let errorMessage = "Failed to upload video";

      if (error.response?.status === 413) {
        errorMessage = "Video file is too large. Maximum size is 500MB.";
      } else if (error.response?.data?.error) {
        errorMessage = error.response.data.error;
      } else if (error.message) {
        errorMessage = error.message;
      }

      toast({
        title: "Upload failed",
        description: errorMessage,
        status: "error",
        duration: 8000,
        isClosable: true,
      });
    } finally {
      setUploading(false);
    }
  };

  const resetUploadForm = () => {
    setUploadFile(null);
    setUploadThumbnail(null);
    setUploadTitle("");
    setUploadDescription("");
    setUploadCategory("");
  };

  const handleEditClick = (video: TutorialVideo, e: React.MouseEvent) => {
    e.stopPropagation(); // Don't trigger video playback
    setEditingVideo(video);
    setEditTitle(video.title);
    setEditDescription(video.description || "");
    setEditCategory(video.category || "");
    setEditThumbnail(null);
    onEditOpen();
  };

  const handleEditThumbnailSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files[0]) {
      setEditThumbnail(event.target.files[0]);
    }
  };

  const handleUpdate = async () => {
    if (!editingVideo || !editTitle) {
      toast({
        title: "Title is required",
        status: "warning",
        duration: 3000,
      });
      return;
    }

    try {
      setUpdating(true);

      // Update text fields
      await api.put(`/api/tutorials/${editingVideo.tutorial_video_id}`, {
        title: editTitle,
        description: editDescription,
        category: editCategory,
      });

      // Update thumbnail if a new one was selected
      if (editThumbnail) {
        const thumbnailFormData = new FormData();
        thumbnailFormData.append("thumbnail", editThumbnail);

        await api.put(
          `/api/tutorials/${editingVideo.tutorial_video_id}/thumbnail`,
          thumbnailFormData,
          {
            headers: { "Content-Type": "multipart/form-data" },
          }
        );
      }

      toast({
        title: "Video updated successfully!",
        status: "success",
        duration: 3000,
      });

      onEditClose();
      loadVideos();
    } catch (error: any) {
      console.error("Update failed:", error);
      toast({
        title: "Update failed",
        description: error.response?.data?.error || error.message,
        status: "error",
        duration: 5000,
      });
    } finally {
      setUpdating(false);
    }
  };

  const handleDelete = async (video: TutorialVideo, e: React.MouseEvent) => {
    e.stopPropagation(); // Don't trigger video playback

    if (!confirm(`Are you sure you want to delete "${video.title}"?`)) {
      return;
    }

    try {
      await api.delete(`/api/tutorials/${video.tutorial_video_id}`);

      toast({
        title: "Video deleted successfully!",
        status: "success",
        duration: 3000,
      });

      loadVideos();
    } catch (error: any) {
      console.error("Delete failed:", error);
      toast({
        title: "Delete failed",
        description: error.response?.data?.error || error.message,
        status: "error",
        duration: 5000,
      });
    }
  };

  const filteredVideos = selectedCategory === "all"
    ? videos
    : videos.filter((v) => v.category === selectedCategory);

  return (
    <Container maxW="container.xl" py={8}>
      {/* Header */}
      <HStack justify="space-between" align="center" mb={6}>
        <Heading size="xl" color="cyan.400" fontWeight="bold">
          Tutorial Gallery
        </Heading>

        {isSuperAdmin && (
          <Button
            leftIcon={<AddIcon />}
            colorScheme="cyan"
            onClick={onUploadOpen}
            size="lg"
          >
            Upload Video
          </Button>
        )}
      </HStack>

      {/* Category Filter */}
      <HStack spacing={2} mb={6} flexWrap="wrap">
        <Tag
          size="lg"
          variant={selectedCategory === "all" ? "solid" : "outline"}
          colorScheme="cyan"
          cursor="pointer"
          onClick={() => setSelectedCategory("all")}
        >
          All
        </Tag>
        {categories.map((cat) => (
          <Tag
            key={cat}
            size="lg"
            variant={selectedCategory === cat ? "solid" : "outline"}
            colorScheme="cyan"
            cursor="pointer"
            onClick={() => setSelectedCategory(cat)}
          >
            {cat}
          </Tag>
        ))}
      </HStack>

      {/* Video Grid */}
      {loading ? (
        <Center py={20}>
          <Spinner size="xl" color="cyan.400" />
        </Center>
      ) : filteredVideos.length === 0 ? (
        <Center py={20}>
          <VStack spacing={4}>
            <FiVideo size={64} color="gray" />
            <Text fontSize="xl" color="gray.500">
              No tutorials available yet
            </Text>
          </VStack>
        </Center>
      ) : (
        <Grid
          templateColumns={{
            base: "1fr",
            md: "repeat(2, 1fr)",
            lg: "repeat(3, 1fr)",
            xl: "repeat(4, 1fr)",
          }}
          gap={6}
        >
          {filteredVideos.map((video) => (
            <Box
              key={video.tutorial_video_id}
              borderWidth="1px"
              borderColor="cyan.400"
              borderRadius="lg"
              overflow="hidden"
              cursor="pointer"
              transition="all 0.2s"
              _hover={{ transform: "scale(1.05)", shadow: "xl" }}
              onClick={() => handleVideoClick(video)}
              bg="rgba(0, 229, 255, 0.05)"
            >
              <AspectRatio ratio={16 / 9}>
                <Box bg="black" position="relative">
                  {video.thumbnail_url ? (
                    <img
                      src={`${import.meta.env.VITE_API_BASE_URL || "https://localhost:5001"}${video.thumbnail_url}`}
                      alt={video.title}
                      style={{ width: "100%", height: "100%", objectFit: "cover" }}
                    />
                  ) : (
                    <Center>
                      <FiVideo size={64} color="cyan" opacity={0.5} />
                    </Center>
                  )}
                  <Center
                    position="absolute"
                    top={0}
                    left={0}
                    right={0}
                    bottom={0}
                    bg="blackAlpha.600"
                    opacity={0}
                    transition="opacity 0.2s"
                    _hover={{ opacity: 1 }}
                  >
                    <ViewIcon boxSize={16} color="cyan.400" />
                  </Center>
                </Box>
              </AspectRatio>

              <VStack align="start" p={4} spacing={2}>
                <HStack justify="space-between" w="full">
                  <Heading size="md" noOfLines={2} flex={1}>
                    {video.title}
                  </Heading>
                  {isSuperAdmin && (
                    <HStack spacing={1}>
                      <IconButton
                        aria-label="Edit video"
                        icon={<EditIcon />}
                        size="sm"
                        colorScheme="cyan"
                        variant="ghost"
                        onClick={(e) => handleEditClick(video, e)}
                      />
                      <IconButton
                        aria-label="Delete video"
                        icon={<DeleteIcon />}
                        size="sm"
                        colorScheme="red"
                        variant="ghost"
                        onClick={(e) => handleDelete(video, e)}
                      />
                    </HStack>
                  )}
                </HStack>
                {video.description && (
                  <Text fontSize="sm" color="gray.400" noOfLines={2}>
                    {video.description}
                  </Text>
                )}
                {video.category && (
                  <Tag size="sm" colorScheme="cyan">
                    {video.category}
                  </Tag>
                )}
              </VStack>
            </Box>
          ))}
        </Grid>
      )}

      {/* Video Player Modal */}
      <Modal isOpen={isPlayerOpen} onClose={handleClosePlayer} size="6xl">
        <ModalOverlay />
        <ModalContent bg="gray.900">
          <ModalHeader>{selectedVideo?.title}</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            {selectedVideo && (
              <VStack spacing={4} align="stretch">
                <AspectRatio ratio={16 / 9}>
                  <video
                    controls
                    autoPlay
                    style={{ width: "100%", height: "100%", backgroundColor: "black" }}
                    src={`${import.meta.env.VITE_API_BASE_URL || "https://localhost:5001"}${selectedVideo.video_url}`}
                  />
                </AspectRatio>
                {selectedVideo.description && (
                  <Text color="gray.300">{selectedVideo.description}</Text>
                )}
              </VStack>
            )}
          </ModalBody>
        </ModalContent>
      </Modal>

      {/* Upload Modal */}
      <Modal isOpen={isUploadOpen} onClose={onUploadClose} size="lg">
        <ModalOverlay />
        <ModalContent bg="gray.900">
          <ModalHeader>Upload Tutorial Video</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            <VStack spacing={4} align="stretch">
              <FormControl isRequired>
                <FormLabel>Video File</FormLabel>
                <Button
                  as="label"
                  leftIcon={<FiUpload />}
                  variant="outline"
                  colorScheme="cyan"
                  w="full"
                  cursor="pointer"
                >
                  {uploadFile ? uploadFile.name : "Choose Video File"}
                  <Input
                    type="file"
                    accept="video/*"
                    onChange={handleFileSelect}
                    display="none"
                  />
                </Button>
              </FormControl>

              <FormControl>
                <FormLabel>Thumbnail Image (Optional)</FormLabel>
                <Button
                  as="label"
                  leftIcon={<FiUpload />}
                  variant="outline"
                  colorScheme="cyan"
                  w="full"
                  cursor="pointer"
                >
                  {uploadThumbnail ? uploadThumbnail.name : "Choose Thumbnail Image"}
                  <Input
                    type="file"
                    accept="image/*"
                    onChange={handleThumbnailSelect}
                    display="none"
                  />
                </Button>
                <Text fontSize="xs" color="gray.500" mt={1}>
                  Recommended: 16:9 aspect ratio (e.g., 1280x720)
                </Text>
              </FormControl>

              <FormControl isRequired>
                <FormLabel>Title</FormLabel>
                <Input
                  value={uploadTitle}
                  onChange={(e) => setUploadTitle(e.target.value)}
                  placeholder="Enter video title"
                />
              </FormControl>

              <FormControl>
                <FormLabel>Description</FormLabel>
                <Textarea
                  value={uploadDescription}
                  onChange={(e) => setUploadDescription(e.target.value)}
                  placeholder="Enter video description"
                  rows={3}
                />
              </FormControl>

              <FormControl>
                <FormLabel>Category</FormLabel>
                <Input
                  value={uploadCategory}
                  onChange={(e) => setUploadCategory(e.target.value)}
                  placeholder="e.g., Getting Started, Advanced Features"
                />
              </FormControl>
            </VStack>
          </ModalBody>
          <ModalFooter>
            <Button variant="ghost" mr={3} onClick={onUploadClose} isDisabled={uploading}>
              Cancel
            </Button>
            <Button
              colorScheme="cyan"
              onClick={handleUpload}
              isLoading={uploading}
              isDisabled={!uploadFile || !uploadTitle}
            >
              Upload
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Edit Modal */}
      <Modal isOpen={isEditOpen} onClose={onEditClose} size="lg">
        <ModalOverlay />
        <ModalContent bg="gray.900">
          <ModalHeader>Edit Tutorial Video</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            <VStack spacing={4} align="stretch">
              <FormControl>
                <FormLabel>Update Thumbnail (Optional)</FormLabel>
                <Button
                  as="label"
                  leftIcon={<FiUpload />}
                  variant="outline"
                  colorScheme="cyan"
                  w="full"
                  cursor="pointer"
                >
                  {editThumbnail ? editThumbnail.name : "Choose New Thumbnail"}
                  <Input
                    type="file"
                    accept="image/*"
                    onChange={handleEditThumbnailSelect}
                    display="none"
                  />
                </Button>
                <Text fontSize="xs" color="gray.500" mt={1}>
                  Leave empty to keep current thumbnail
                </Text>
              </FormControl>

              <FormControl isRequired>
                <FormLabel>Title</FormLabel>
                <Input
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  placeholder="Enter video title"
                />
              </FormControl>

              <FormControl>
                <FormLabel>Description</FormLabel>
                <Textarea
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  placeholder="Enter video description"
                  rows={3}
                />
              </FormControl>

              <FormControl>
                <FormLabel>Category</FormLabel>
                <Input
                  value={editCategory}
                  onChange={(e) => setEditCategory(e.target.value)}
                  placeholder="e.g., Getting Started, Advanced Features"
                />
              </FormControl>
            </VStack>
          </ModalBody>
          <ModalFooter>
            <Button variant="ghost" mr={3} onClick={onEditClose} isDisabled={updating}>
              Cancel
            </Button>
            <Button
              colorScheme="cyan"
              onClick={handleUpdate}
              isLoading={updating}
              isDisabled={!editTitle}
            >
              Update
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </Container>
  );
}
