import React, { useRef, useState } from "react";
import { Box, Button, Image, Input, useToast, Spinner } from "@chakra-ui/react";
import { useAuthStore } from "../store/useAuthStore";
import axios from "axios";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:5001";

const UploadProfileImage: React.FC = () => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const user = useAuthStore((s) => s.user);
  const setAuth = useAuthStore((s) => s.setAuth);
  const toast = useToast();
  const [isUploading, setIsUploading] = useState(false);

  const handleUpload = async (file: File) => {
    if (!user?.user_id) return;

    const formData = new FormData();
    formData.append("image", file);

    try {
      setIsUploading(true);
      console.log(
        "UPLOADING",
        `${API_BASE_URL}/api/upload-image?type=users&id=${user.user_id}`,
        formData,
        "tyhast"
      );
      const response = await axios.post(
        `${API_BASE_URL}/api/upload-image?type=users&id=${user.user_id}`,
        formData,
        {
          headers: { "Content-Type": "multipart/form-data" },
        }
      );

      const updatedUser = {
        ...user,
        user_profile_image: response.data.path,
      };
      setAuth(updatedUser, user.jwt || "");

      toast({
        title: "Profile image updated",
        status: "success",
        duration: 3000,
        isClosable: true,
      });
    } catch (err) {
      console.error("Upload failed", err);
      toast({
        title: "Upload failed",
        description: "Unable to upload profile image.",
        status: "error",
        duration: 3000,
        isClosable: true,
      });
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <Box textAlign="center">
      {user?.user_profile_image && (
        <Image
          src={`${API_BASE_URL}/${user.user_profile_image}`}
          boxSize="120px"
          borderRadius="full"
          mx="auto"
          mb={4}
        />
      )}
      <Input
        type="file"
        accept="image/*"
        ref={fileInputRef}
        onChange={(e) => {
          if (e.target.files?.[0]) {
            handleUpload(e.target.files[0]);
          }
        }}
        style={{ display: "none" }}
      />
      <Button
        onClick={() => fileInputRef.current?.click()}
        isLoading={isUploading}
        loadingText="Uploading"
        colorScheme="teal"
      >
        Upload New Image
      </Button>
    </Box>
  );
};

export default UploadProfileImage;
